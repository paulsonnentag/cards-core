import {
  initSubduction,
  Repo,
  type AutomergeUrl,
  type DocHandle,
  type StorageId,
} from "@automerge/automerge-repo";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";

// the server pushwork publishes to
export const SYNC_SERVER =
  process.env.PUSHWORK_SUBDUCTION_SERVER ??
  "wss://subduction.sync.inkandswitch.com";

// a repo that syncs with the server and caches what it reads in `dir`
export async function openRepo(dir: string): Promise<Repo> {
  await initSubduction();
  return new Repo({
    storage: new NodeFSStorageAdapter(dir),
    network: [],
    subductionWebsocketEndpoints: [SYNC_SERVER],
  });
}

// The document as the server has it. `find` answers from storage first, which may be behind, and stored sync info
// is from an earlier session. So this waits until we hold every head the server advertised, and either the server
// advertised them since the call or, connected, our heads have been still for QUIET (a server with nothing new says
// nothing). Gives up after `timeout` and answers with what is here.
export async function findCurrent(
  repo: Repo,
  url: AutomergeUrl,
  timeout = 15_000,
): Promise<DocHandle<unknown>> {
  const since = Date.now();
  const handle = await repo.find<unknown>(url);
  let heads = handle.heads().join();
  let still = Date.now(); // since when heads haven't moved, while connected
  for (const deadline = since + timeout; Date.now() < deadline; ) {
    const [server] = repo.isSubductionConnected()
      ? await repo.connectedSubductionPeerIds()
      : [];
    if (!server || heads !== handle.heads().join()) {
      heads = handle.heads().join();
      still = Date.now();
    }
    const info = server && handle.getSyncInfo(server as StorageId);
    if (
      info &&
      info.lastHeads.length > 0 &&
      handle.containsHeads(info.lastHeads) &&
      (info.lastSyncTimestamp >= since || Date.now() - still >= QUIET)
    )
      return handle;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return handle;
}

const QUIET = 1_000;

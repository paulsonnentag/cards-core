import type { DocHandle, Repo, UrlHeads } from "@automerge/automerge-repo";
import {
  HANDOFF_CHANNEL,
  type HandoffReplyMessage,
  type HandoffRequestMessage,
} from "@inkandswitch/patchwork-bootloader/types";
import { resolvePath } from "@inkandswitch/patchwork-filesystem";
import { handoffTarget } from "./urls";

// how long a request waits for heads this tab doesn't have yet
const HEADS_TIMEOUT = 30_000;

// Answers the service worker's handoff requests for package files from `repo`, by writing each response into the
// worker's cache. Every tab answers; the first write wins.
export function startResponder(repo: Repo) {
  const channel = new BroadcastChannel(HANDOFF_CHANNEL);
  channel.addEventListener("message", ({ data }) => {
    if (data?.type === "request") void answer(data as HandoffRequestMessage);
  });
  channel.postMessage({ type: "online" });

  async function answer({ id, cachename, request }: HandoffRequestMessage) {
    let reply: HandoffReplyMessage;
    try {
      const response = await respond(request.handoffURL);
      const cache = await caches.open(cachename);
      await cache.put(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          referrer: request.referrer,
        }),
        response,
      );
      reply = { id, type: "cached" };
    } catch (error) {
      reply = {
        id,
        type: "response",
        response: {
          status: error instanceof Failure ? error.status : 500,
          body: error instanceof Error ? error.message : String(error),
          headers: { "content-type": "text/plain" },
        },
      };
    }
    channel.postMessage(reply);
  }

  async function respond(handoffUrl: string): Promise<Response> {
    const { url, heads, path } = handoffTarget(handoffUrl);
    // the browser memoizes a module under its first url, so a headless one could never update
    if (!heads) throw new Failure(400, `${handoffUrl} has no heads`);
    const handle = await repo.find(url);
    await headsArrive(handle, heads);
    const file = await resolvePath(repo, handle.view(heads), path);
    if (!file) throw new Failure(404, `${handoffUrl} not found`);
    return new Response(file.content as BodyInit, {
      headers: { "content-type": file.type },
    });
  }
}

class Failure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function headsArrive(handle: DocHandle<unknown>, heads: UrlHeads) {
  if (handle.containsHeads(heads)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!handle.containsHeads(heads)) return;
      done();
      resolve();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Failure(504, `${handle.url} hasn't reached ${heads}`));
    }, HEADS_TIMEOUT);
    const done = () => {
      clearTimeout(timer);
      handle.off("heads-changed", check);
    };
    handle.on("heads-changed", check);
  });
}

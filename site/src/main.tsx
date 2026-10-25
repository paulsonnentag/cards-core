import {
  initSubduction,
  isValidAutomergeUrl,
  Repo,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { WebCryptoSigner } from "@automerge/automerge-subduction";
import {
  backend,
  NewNode,
  Node,
  state,
  tag,
  type CardDescriptor,
} from "@cards/core";
import type { Viewed } from "@cards/core/render";
import { createLoader } from "@cards/loader";
import { Dynamic, render } from "solid-js/web";
import environment from "virtual:loader/environment";
import packages from "virtual:cards/packages";
import { dealer } from "./dealer";
import { presence } from "./presence";
import "./theme.css";

// the tags this site lays out a new space with, from the packages that own them
const t = {
  shape: tag(packages.shapes, "shape"),
  canvas: tag(packages.shapes, "canvas"),
  pointer: tag(packages.tools, "pointer"),
  select: tag(packages.tools, "select"),
  default: tag(packages.tools, "default"),
  inspector: tag(packages.tools, "inspector"),
  pen: tag(packages.lines, "pen"),
  deck: tag(packages.deck, "deck"),
  map: tag(packages.map, "map"),
};
const BERLIN = { center: [13.388, 52.517], zoom: 9.5 };
const SYNC_SERVER =
  import.meta.env.VITE_SYNC_SERVER ?? "wss://subduction.sync.inkandswitch.com";

// other tabs see each other directly; other browsers through the sync server
await initSubduction();
const repo = new Repo({
  storage: new IndexedDBStorageAdapter(),
  network: [new BroadcastChannelNetworkAdapter()],
  subductionWebsocketEndpoints: [SYNC_SERVER],
  signer: await WebCryptoSigner.setup(),
});
const loader = createLoader({ repo, environment });
const root = await openSpace();

root.attach(dealer(loader));
root.attach(presence(repo, userUrl(root)));

render(
  () => <Dynamic component={state<Viewed>(root).view} />,
  document.getElementById("app")!,
);

if (import.meta.env.DEV) Object.assign(globalThis, { root, loader });

// the space in the url, or a new one
async function openSpace(): Promise<Node> {
  const existing = location.hash.slice(1);
  if (isValidAutomergeUrl(existing)) return withBackend(existing);

  // the root is the one document created outside the backend, which needs a root to answer from
  const handle = repo.create({ ...tagged(t.canvas), children: [] as string[] });
  const root = withBackend(handle.url);
  const layout = await seed(root);
  handle.change((d) => d.children.push(...layout.map((n) => n.url)));
  location.hash = handle.url;
  return root;
}

function withBackend(url: AutomergeUrl): Node {
  const root = new Node(url);
  root.attach(backend(repo));
  return root;
}

// a deck with every card of every package, and a few tools and a map to try them on
async function seed(root: Node): Promise<Node[]> {
  const { request } = root;
  const cards: Node[] = [];
  for (const url of Object.values(packages)) {
    const { cards: descriptors } = await loader.load<{
      cards: CardDescriptor[];
    }>(url);
    for (const descriptor of descriptors)
      cards.push(
        request(NewNode, {
          ...tagged(t.shape, "card"),
          x: 0,
          y: 0,
          card: tag(url, descriptor.id),
          ...(descriptor.example && { example: descriptor.example(root) }),
        }),
      );
  }

  return [
    request(NewNode, { ...tagged(t.shape, t.select, t.default), x: 16, y: 16 }),
    request(NewNode, { ...tagged(t.shape, t.pen), x: 112, y: 16 }),
    request(NewNode, { ...tagged(t.shape, t.inspector), x: 16, y: 64 }),
    request(NewNode, {
      ...tagged(t.shape, t.deck),
      x: 340,
      y: 16,
      children: cards,
    }),
    request(NewNode, {
      ...tagged(t.shape, t.map),
      x: 340,
      y: 346,
      width: 600,
      height: 380,
      camera: BERLIN,
      children: [],
    }),
  ];
}

// the user at this keyboard, with their pointer; one per tab, so two tabs are two cursors
function userUrl({ request }: Node): AutomergeUrl {
  const existing = sessionStorage.getItem("cards-user");
  if (isValidAutomergeUrl(existing)) return existing;

  const { url } = request(NewNode, {
    "@tags": { user: true },
    pointer: request(NewNode, { ...tagged(t.shape, t.pointer), x: 0, y: 0 }),
  });
  sessionStorage.setItem("cards-user", url);
  return url;
}

function tagged(...tags: string[]) {
  return {
    "@tags": Object.fromEntries(tags.map((tag) => [tag, true as const])),
  };
}

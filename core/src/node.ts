import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  batch,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
  type Signal,
} from "solid-js";
import {
  dispatch,
  registry,
  type Entry,
  type Handler,
  type Message,
} from "./messages";

export type Process = AutomergeUrl | undefined; // the card acting; undefined = bootstrap
export type Behavior = (node: Node) => void;

// one attachment's view of the tree: who is acting, how long for, and the root it hangs from. Nodes are one per
// url per scope, so the same object stands for a node wherever it moves
export type Scope = {
  process: Process;
  accepts?: Set<string>; // the messages a card declared; undefined for the host, which handles anything
  owner: Owner | null;
  root?: Node;
  nodes: Map<AutomergeUrl, Node>;
};

export class Node {
  constructor(
    readonly url: AutomergeUrl,
    readonly scope: Scope = detached(),
  ) {}

  // where the node sits now; the backend keeps this up to date from what the documents reference
  get parent(): Node | undefined {
    const url = parentOf(this.url)[0]();
    return url === undefined ? undefined : nodeIn(this.scope, url);
  }
  get process(): Process {
    return this.scope.process;
  }
  get owner(): Owner | null {
    return this.scope.owner;
  }

  // methods are arrow fields so behaviors can destructure them: ({ request, on }) => …

  // handlers live as long as the computation that registered them, or else the process
  on = <Req, Res>(msg: Message<Req, Res>, handler: Handler<Req, Res>): void => {
    const { accepts, process } = this.scope;
    if (accepts && !accepts.has(msg))
      throw new Error(`card ${process} handles ${msg} without accepting it`);
    const [, set] = registry(this.url);
    const entry: Entry = { type: msg, handler, process };
    set((hs) => [entry, ...hs]);
    runWithOwner(getOwner() ?? this.owner, () =>
      onCleanup(() => set((hs) => hs.filter((h) => h !== entry))),
    );
  };

  // bubbles up: this node's handlers (newest first), then its ancestors'
  request = <Req, Res>(msg: Message<Req, Res>, req?: Req): Res =>
    dispatch(this, msg, req, this);

  // runs a behavior on this node as `card`, in a scope of its own; without a card it runs as the host
  attach = (
    behavior: Behavior,
    card?: { url: AutomergeUrl; accepts: Message<any, any>[] },
  ): (() => void) =>
    createRoot((dispose) => {
      const scope: Scope = {
        process: card?.url,
        accepts: card && new Set(card.accepts),
        owner: getOwner(),
        nodes: new Map(),
      };
      scope.root = nodeIn(scope, (this.scope.root ?? topOf(this)).url);
      behavior(nodeIn(scope, this.url));
      return dispose;
    });
}

// the node for `url` as seen from `scope`
export function nodeIn(scope: Scope, url: AutomergeUrl): Node {
  return (
    scope.nodes.get(url) ?? scope.nodes.set(url, new Node(url, scope)).get(url)!
  );
}

// where every reachable node sits, from a walk of the tree; anything not listed has no parent
export function setParents(
  parents: Map<AutomergeUrl, AutomergeUrl | undefined>,
) {
  batch(() => {
    for (const [url, [, set]] of parentSignals)
      if (!parents.has(url)) set(undefined);
    for (const [url, parent] of parents) parentOf(url)[1](parent);
  });
}

function parentOf(url: AutomergeUrl): Signal<AutomergeUrl | undefined> {
  return (
    parentSignals.get(url) ??
    parentSignals
      .set(url, createSignal<AutomergeUrl | undefined>(undefined))
      .get(url)!
  );
}

function topOf(node: Node): Node {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

function detached(): Scope {
  return { process: undefined, owner: null, nodes: new Map() };
}

const parentSignals = new Map<AutomergeUrl, Signal<AutomergeUrl | undefined>>();

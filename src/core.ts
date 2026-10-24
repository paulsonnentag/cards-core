import * as A from "@automerge/automerge";
import {
  generateAutomergeUrl,
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import {
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  type Owner,
  type Signal,
} from "solid-js";

export type Process = AutomergeUrl | undefined; // the card acting; undefined = bootstrap
export type Message<Req, Res> = string & { __req?: Req; __res?: Res };
export type Handler<Req, Res> = (req: Req, next: (req?: Req) => Res, from: Node) => Res;
export type Behavior = (node: Node) => void;

export class Node {
  constructor(
    readonly url: AutomergeUrl,
    readonly parent?: Node,
    readonly process?: Process,
    readonly owner: Owner | null = null,
  ) {}

  // a complete document that is not stored anywhere yet; assign it inside a change to place it
  static create<T>(initial: T): Node {
    const url = generateAutomergeUrl();
    fresh.set(url, A.from(initial as any));
    return new Node(url);
  }

  // handlers live as long as the process that registered them
  on<Req, Res>(msg: Message<Req, Res>, handler: Handler<Req, Res>): void {
    const [, set] = registry(this.url);
    const entry: Entry = { type: msg, handler };
    set((hs) => [entry, ...hs]);
    runWithOwner(this.owner ?? getOwner(), () =>
      onCleanup(() => set((hs) => hs.filter((h) => h !== entry))),
    );
  }

  // bubbles up: this node's handlers (newest first), then its ancestors'
  request<Req, Res>(msg: Message<Req, Res>, req?: Req): Res {
    return dispatch(this, msg, req, this);
  }

  attach(behavior: Behavior, card?: AutomergeUrl): () => void {
    return createRoot((dispose) => {
      behavior(rebind(this, card, getOwner()));
      return dispose;
    });
  }
}

export function message<Req, Res>(type: string): Message<Req, Res> {
  return type as Message<Req, Res>;
}

// the one state message, answered by the backend at the root: an object's state as the requesting process sees it
export const State = message<void, State>("core/state");

export type State<T = any> = {
  read(): T; // stored value with overlays applied; urls come back as nodes
  change(fn: (doc: T) => void): void; // write to the stored value, attributed to the requesting card
  overlay(partial: Partial<T>): void; // layer ephemeral values on top, for this process
  overlays(): Record<string, Overlay>; // every key that has an overlay
  overlays(key: keyof T & string): Overlay | undefined; // just that key
};

export type Overlay = {
  stored?: unknown;
  layers: { process: Process; value: unknown; seq: number }[]; // newest first
};

// the nearest node tagged `tag`, checking each ancestor and its direct children, as seen by the requester.
// With `orCreate`, a missing object is created in the root's `objects` from that template.
export const Lookup = message<{ tag: string; orCreate?: Record<string, unknown> }, Node | undefined>("core/lookup");

export function rootOf(node: Node): Node {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

export function backend(repo: Repo): Behavior {
  const docs = new Map<AutomergeUrl, Stored>();
  const layers = new Map<AutomergeUrl, Signal<Layers>>();
  let seq = 0;

  return (root) => {
    root.on(State, (_, __, from) => ({
      read: () => hydrate(overlay(docOf(from.url).read(), layersOf(from.url)[0]()), from),
      change: (fn) => docOf(from.url).change((draft) => fn(adopting(draft)), from.process),
      overlay: (partial) => put(from, partial),
      overlays: ((key?: string) => {
        const all = overlays(docOf(from.url).read(), layersOf(from.url)[0]());
        return key === undefined ? all : all[key];
      }) as State["overlays"],
    }));

    root.on(Lookup, ({ tag, orCreate }, _, from) => {
      const found = find(from, tag);
      if (found || !orCreate) return found;

      const top = rootOf(from);
      const tags = { ...(orCreate["@tags"] as object), [tag]: true };
      const created = Node.create({ ...orCreate, "@tags": tags });
      top.request(State).change((d) => {
        if (!d.objects) d.objects = [];
        d.objects.push(created);
      });
      return childOf(top, created.url);
    });
  };

  function find(from: Node, tag: string): Node | undefined {
    for (let n: Node | undefined = from; n; n = n.parent) {
      if (hasTag(n, tag)) return n;
      const sibling = childrenOf(n).find((c) => hasTag(c, tag));
      if (sibling) return sibling;
    }
    return undefined;
  }

  function put(from: Node, partial: Record<string, unknown>) {
    const [current, set] = layersOf(from.url);
    if (!untrack(current).has(from.process)) {
      // the layer disappears with the process that wrote it
      runWithOwner(from.owner, () => onCleanup(() => set((m) => without(m, from.process))));
    }
    set((m) => withPut(m, from.process, partial, () => ++seq));
  }

  // wraps a change draft so that assigning a Node stores its url, importing fresh documents on the way.
  // The proxy target is a dummy: proxying an automerge proxy directly trips invariant checks on method names.
  function adopting(draft: any): any {
    return new Proxy(Array.isArray(draft) ? [] : {}, {
      get: (_, k) => {
        const v = draft[k];
        if (typeof v === "function") return (...args: unknown[]) => v.apply(draft, args.map(adopt));
        return v !== null && typeof v === "object" ? adopting(v) : v;
      },
      set: (_, k, v) => ((draft[k] = adopt(v)), true),
      has: (_, k) => k in draft,
      deleteProperty: (_, k) => (delete draft[k], true),
    });
  }

  function adopt(value: unknown): unknown {
    if (!(value instanceof Node)) return value;
    const doc = fresh.get(value.url);
    if (doc) {
      const handle = repo.import(A.save(doc), { docId: parseAutomergeUrl(value.url).documentId });
      docs.set(value.url, track(handle));
      fresh.delete(value.url);
    }
    return value.url;
  }

  function docOf(url: AutomergeUrl): Stored {
    return docs.get(url) ?? docs.set(url, load(url)).get(url)!;
  }

  function layersOf(url: AutomergeUrl): Signal<Layers> {
    return layers.get(url) ?? layers.set(url, createSignal<Layers>(new Map())).get(url)!;
  }

  function load(url: AutomergeUrl): Stored {
    const [doc, setDoc] = createSignal<any>();
    let handle: DocHandle<any> | undefined;
    repo.find(url).then((h) => {
      handle = h;
      setDoc(() => h.doc());
      h.on("change", ({ doc }) => setDoc(() => doc));
    });
    return {
      read: () => doc() ?? {},
      change: (fn, process) => handle?.change(fn, process ? { message: process } : undefined),
    };
  }

  function track(handle: DocHandle<any>): Stored {
    const [doc, setDoc] = createSignal<any>(handle.doc());
    handle.on("change", ({ doc }) => setDoc(() => doc));
    return {
      read: () => doc() ?? {},
      change: (fn, process) => handle.change(fn, process ? { message: process } : undefined),
    };
  }
}

type Stored = { read(): any; change(fn: (doc: any) => void, process: Process): void };
type Layer = Record<string, { value: unknown; seq: number }>;
type Layers = Map<Process, Layer>;

const fresh = new Map<AutomergeUrl, A.Doc<any>>(); // created, not yet placed in a document

// urls read through `parent` become nodes under it, stable per parent so views keep their identity
const children = new WeakMap<Node, Map<AutomergeUrl, Node>>();

function hydrate(value: unknown, parent: Node): any {
  if (typeof value === "string") return isValidAutomergeUrl(value) ? childOf(parent, value) : value;
  if (value === null || typeof value !== "object" || value instanceof Node) return value;
  return new Proxy(value, { get: (t, k) => hydrate(Reflect.get(t, k), parent) });
}

function childOf(parent: Node, url: AutomergeUrl): Node {
  const known = children.get(parent) ?? children.set(parent, new Map()).get(parent)!;
  return known.get(url) ?? known.set(url, new Node(url, parent, parent.process, parent.owner)).get(url)!;
}

function hasTag(node: Node, tag: string): boolean {
  return Boolean(node.request(State).read()["@tags"]?.[tag]);
}

// nodes referenced directly from a node's state, or from a list in it
function childrenOf(node: Node): Node[] {
  const out: Node[] = [];
  for (const value of Object.values(node.request(State).read())) {
    if (value instanceof Node) out.push(value);
    else if (Array.isArray(value)) out.push(...value.filter((v): v is Node => v instanceof Node));
  }
  return out;
}

// the same position in the tree, seen by another process
function rebind(node: Node, process: Process, owner: Owner | null): Node {
  const parent = node.parent && rebind(node.parent, process, owner);
  return new Node(node.url, parent, process, owner);
}

function overlay(doc: Record<string, unknown>, layers: Layers) {
  const merged: Record<string, unknown> = { ...doc };
  const newest: Record<string, number> = {};
  for (const layer of layers.values()) {
    for (const [key, { value, seq }] of Object.entries(layer)) {
      if (seq > (newest[key] ?? -1)) {
        newest[key] = seq;
        merged[key] = value;
      }
    }
  }
  return merged;
}

function overlays(doc: Record<string, unknown>, layers: Layers): Record<string, Overlay> {
  const out: Record<string, Overlay> = {};
  for (const [process, layer] of layers) {
    for (const [key, { value, seq }] of Object.entries(layer)) {
      (out[key] ??= { stored: doc[key], layers: [] }).layers.push({ process, value, seq });
    }
  }
  for (const o of Object.values(out)) o.layers.sort((a, b) => b.seq - a.seq);
  return out;
}

function withPut(layers: Layers, process: Process, partial: Record<string, unknown>, next: () => number) {
  const layer: Layer = { ...layers.get(process) };
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) delete layer[key];
    else layer[key] = { value, seq: next() };
  }
  return new Map(layers).set(process, layer);
}

function without(layers: Layers, process: Process) {
  const copy = new Map(layers);
  copy.delete(process);
  return copy;
}

type Entry = { type: string; handler: Handler<any, any> };
const handlers = new Map<AutomergeUrl, Signal<Entry[]>>();

function registry(url: AutomergeUrl): Signal<Entry[]> {
  return handlers.get(url) ?? handlers.set(url, createSignal<Entry[]>([])).get(url)!;
}

function dispatch(here: Node | undefined, type: string, req: unknown, from: Node): any {
  if (!here) throw new Error(`unhandled ${type} from ${from.url}`);
  const own = registry(here.url)[0]()
    .filter((e) => e.type === type)
    .map((e) => e.handler);
  return run(0, req);

  function run(i: number, r: unknown): any {
    if (i < own.length) return own[i](r, (next = r) => run(i + 1, next), from);
    return dispatch(here!.parent, type, r, from);
  }
}

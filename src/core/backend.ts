import * as A from "@automerge/automerge";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import {
  createSignal,
  onCleanup,
  runWithOwner,
  untrack,
  type Signal,
} from "solid-js";
import { Node, takeFresh, type Behavior, type Process } from "./node";
import { applyPuts, overlays, withPut, without, type Layers } from "./puts";
import { State } from "./state";
import { childNodes, hasTag, Lookup, rootOf } from "./tree";

// Attached to the root: answers State and Lookup for every node, from documents in `repo` and puts in memory.
export function backend(repo: Repo): Behavior {
  const docs = new Map<AutomergeUrl, Stored>();
  const layers = new Map<AutomergeUrl, Signal<Layers>>();
  let seq = 0;

  return (root) => {
    root.on(State, (_, __, from) => ({
      read: () =>
        hydrate(
          applyPuts(docOf(from.url).read(), layersOf(from.url)[0]()),
          from,
        ),
      change: (fn) =>
        docOf(from.url).change((draft) => fn(adopting(draft)), from.process),
      put: ((path: string | Record<string, unknown>, value?: unknown) =>
        put(
          from,
          typeof path === "string" ? { [path]: value } : path,
        )) as State["put"],
      overlays: ((path?: string) => {
        const all = overlays(docOf(from.url).read(), layersOf(from.url)[0]());
        return path === undefined ? all : all[path];
      }) as State["overlays"],
      clone: () =>
        Node.create(structuredClone(untrack(() => docOf(from.url).read()))),
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
      const sibling = childNodes(n).find((c) => hasTag(c, tag));
      if (sibling) return sibling;
    }
    return undefined;
  }

  function put(from: Node, values: Record<string, unknown>) {
    const [current, set] = layersOf(from.url);
    if (!untrack(current).has(from.process)) {
      // the layer disappears with the process that wrote it
      runWithOwner(from.owner, () =>
        onCleanup(() => set((m) => without(m, from.process))),
      );
    }
    set((m) => withPut(m, from.process, values, () => ++seq));
  }

  // wraps a change draft so that assigning a Node stores its url, importing fresh documents on the way.
  // The proxy target is a dummy: proxying an automerge proxy directly trips invariant checks on method names.
  function adopting(draft: any): any {
    return new Proxy(Array.isArray(draft) ? [] : {}, {
      get: (_, k) => {
        const v = draft[k];
        if (typeof v === "function")
          return (...args: unknown[]) => v.apply(draft, args.map(adopt));
        return v !== null && typeof v === "object" ? adopting(v) : v;
      },
      set: (_, k, v) => ((draft[k] = adopt(v)), true),
      has: (_, k) => k in draft,
      deleteProperty: (_, k) => (delete draft[k], true),
    });
  }

  function adopt(value: unknown): unknown {
    if (!(value instanceof Node)) return value;
    const doc = takeFresh(value.url);
    if (doc) {
      const handle = repo.import(A.save(doc), {
        docId: parseAutomergeUrl(value.url).documentId,
      });
      docs.set(value.url, track(handle));
    }
    return value.url;
  }

  function docOf(url: AutomergeUrl): Stored {
    return docs.get(url) ?? docs.set(url, load(url)).get(url)!;
  }

  function layersOf(url: AutomergeUrl): Signal<Layers> {
    return (
      layers.get(url) ??
      layers.set(url, createSignal<Layers>(new Map())).get(url)!
    );
  }

  // a document reads as empty until it's here
  function load(url: AutomergeUrl): Stored {
    const [doc, setDoc] = createSignal<any>();
    let handle: DocHandle<any> | undefined;
    whenReady(repo, url, (h) => {
      handle = h;
      setDoc(() => h.doc());
      h.on("change", ({ doc }) => setDoc(() => doc));
    });
    return {
      read: () => doc() ?? {},
      change: (fn, process) =>
        handle?.change(fn, process ? { message: process } : undefined),
    };
  }

  function track(handle: DocHandle<any>): Stored {
    const [doc, setDoc] = createSignal<any>(handle.doc());
    handle.on("change", ({ doc }) => setDoc(() => doc));
    return {
      read: () => doc() ?? {},
      change: (fn, process) =>
        handle.change(fn, process ? { message: process } : undefined),
    };
  }
}

type Stored = {
  read(): any;
  change(fn: (doc: any) => void, process: Process): void;
};

// calls `ready` with the document's handle once there is one, now or when a peer that has it connects. Unlike
// `repo.find`, this never fails: a document nobody has yet is simply not here yet
export function whenReady(
  repo: Repo,
  url: AutomergeUrl,
  ready: (handle: DocHandle<any>) => void,
) {
  const query = repo.findWithProgress(url);
  let done = false;
  const check = (state: ReturnType<typeof query.peek>) => {
    if (done) return;
    if (state.state === "unavailable")
      console.warn(`${url} is not available from any peer yet`);
    if (state.state !== "ready") return;
    done = true;
    ready(state.handle);
  };
  check(query.peek());
  query.subscribe(check);
}

// urls read through `parent` become nodes under it, stable per parent so views keep their identity
const children = new WeakMap<Node, Map<AutomergeUrl, Node>>();

function hydrate(value: unknown, parent: Node): any {
  if (typeof value === "string")
    return isValidAutomergeUrl(value) ? childOf(parent, value) : value;
  if (value === null || typeof value !== "object" || value instanceof Node)
    return value;
  return new Proxy(value, {
    get: (t, k) => hydrate(Reflect.get(t, k), parent),
  });
}

function childOf(parent: Node, url: AutomergeUrl): Node {
  const known =
    children.get(parent) ?? children.set(parent, new Map()).get(parent)!;
  return (
    known.get(url) ??
    known
      .set(url, new Node(url, parent, parent.process, parent.owner))
      .get(url)!
  );
}

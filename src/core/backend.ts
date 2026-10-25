import * as A from "@automerge/automerge";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import {
  createComputed,
  createSignal,
  onCleanup,
  runWithOwner,
  untrack,
  type Signal,
} from "solid-js";
import { Node, nodeIn, takeFresh, type Behavior, type Process } from "./node";
import { applyPuts, overlays, withPut, without, type Layers } from "./puts";
import { State } from "./state";
import { childNodes, hasTag, Lookup, rootOf, walk } from "./tree";

// Attached to the root: answers State and Lookup for every node, from documents in `repo` and puts in memory,
// and keeps every node's `parent` current from what the documents reference.
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
      // a real document at once, so it can be held and rendered before anything places it
      clone: () => {
        const handle = repo.create(
          structuredClone(untrack(() => docOf(from.url).read())),
        );
        docs.set(handle.url, track(handle));
        return nodeIn(from.scope, handle.url);
      },
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
      return nodeIn(top.scope, created.url);
    });

    // keeps every node's parent current, whether or not anything else walks the tree
    createComputed(() => walk(root));
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

// urls read by `from` become nodes in its scope
function hydrate(value: unknown, from: Node): any {
  if (typeof value === "string")
    return isValidAutomergeUrl(value) ? nodeIn(from.scope, value) : value;
  if (value === null || typeof value !== "object" || value instanceof Node)
    return value;
  return new Proxy(value, {
    get: (t, k) => hydrate(Reflect.get(t, k), from),
  });
}

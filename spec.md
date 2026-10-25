# Packages, cards, and messages

Status: proposal
Scope: `src/core`, `src/compile.ts`, `src/dealer.ts`, `src/container.tsx`, `src/cards/*`

## Summary

This document proposes three changes to how code is organized and shared in Cards:

- Split **packages** from **cards**. A package is an Automerge document that holds source files and is the unit of code and dependencies. A card is a node in the tree that activates one behavior from a package.
- Share behavior only through **messages**. Helpers that read or write documents, such as `placeIn`, become messages that a card handles. Packages share types, tags, and message definitions through ordinary JavaScript imports.
- Load package code as real ES modules through a service worker, so that a module can derive the package it belongs to from `import.meta.url`. Tags and messages are then qualified by the package URL without a compiler step or a virtual module.

A fourth, smaller change follows from the first three: a card declares which messages it accepts, and the runtime rejects handlers for anything else.

## Goals

- One mechanism for sharing: imports carry contracts, messages carry behavior.
- One definition per message and per tag. Today `Drop` is declared in five files and `PointerDown` in four, and they agree only because they spell the same string.
- Tags that are owned by a package, so that two packages can both define `line` without colliding.
- Live dependencies. When a package changes, the cards that depend on it are re-attached with the new code, as the dealer already does for a single card's source.
- No change to the message protocol itself. `dispatch`, `on`, and `request` keep their semantics.

## Non-goals

- An in-app code editor. This proposal makes one possible but doesn't include it.
- Pinned dependency versions between packages. The design allows them later; see [Open questions](#open-questions).
- Moving the Automerge repo into a shared worker. The service worker design permits it, but the first implementation answers requests from the tab.

## Background

Cards are stored as documents whose `source` field is TSX. The dealer compiles that source with Babel in the browser and attaches the resulting behavior to every node that carries the card's `matches` tag. A card can import from a fixed set of host modules (`compile.ts`):

```ts
const modules = {
  "solid-js": solid,
  "solid-js/web": solidWeb,
  "solid-js/store": solidStore,
  "maplibre-gl": maplibre,
  core,
  container,
  dom,
};
```

This leads to two splits that are hard to reason about:

1. **Behavior is shared two ways.** `container.tsx` exports `placeIn`, `removeFrom`, `taker`, and `myPointer`. These functions read and write documents and walk the tree, so they are the container protocol in function form, while `Drop` and `Pan` are the same protocol in message form. `taker` is the `dispatch` ancestor walk written by hand.
2. **Contracts are defined in cards but can't be imported from them.** `Shape`, `Container`, `DropRequest`, and `PointerInput` live in card files. The host imports them as types, but a card can't import another card at run time, so every card re-declares the message constants it uses.

Patchwork ([`patchwork-next`](../patchwork-next)) solves the loading half of this problem with a service worker that serves Automerge folder documents over HTTP, pins module URLs to document heads, and uses an import map for host libraries. This proposal adopts that approach.

## Terminology

**Package**
: An Automerge document that holds source files. The unit of code, dependencies, and tag ownership.

**Card**
: A node in the tree that names a package and one of its card descriptors. The unit of dealing: the dealer attaches the descriptor's behavior to every node carrying the descriptor's tag.

**Card descriptor**
: An object exported by a package's entry module that describes one card: its title, the tag it matches, the messages it accepts, and its behavior.

**Tag**
: A string of the form `<package URL>#<name>`. Owned by the package whose URL it carries.

**Message**
: A string of the form `<package URL>#<name>`, typed with a request and a response, as `message<Req, Res>()` does today.

**Host**
: The code bundled with the application: `core`, `dom`, the renderer, the dealer, presence, and the seed in `main.tsx`.

## Design

### Packages

A package is a directory document in the format Patchwork uses, so that `resolvePath` from `@inkandswitch/patchwork-filesystem` can serve it unchanged:

```json
{
  "@patchwork": { "type": "directory" },
  "package.json": "{ \"name\": \"shapes\", \"main\": \"index.tsx\", \"dependencies\": {} }",
  "index.tsx": "…",
  "canvas.tsx": "…",
  "container.tsx": "…"
}
```

`package.json` holds only `name`, `main`, and `dependencies`. Everything that describes cards, tags, and messages is code in the entry module.

The repository keeps packages as folders under `src/packages/<name>/` so that `tsc` checks them. The seed in `main.tsx` uploads each folder as one package document.

### Entry module

The entry module is a package's public surface. It exports types, tags, messages, and card descriptors. It does not contain behavior.

```tsx
// src/packages/shapes/index.tsx
import { card, message, packageUrl, tag, type Node, type Tagged } from "core";

export const url = packageUrl(import.meta.url);

export const tags = {
  shape: tag(url, "shape"),
  container: tag(url, "container"),
  surface: tag(url, "surface"),
  canvas: tag(url, "canvas"),
};

export type Point = { x: number; y: number };
export type Shape = Tagged & { x: number; y: number; scale?: number };
export type Container = Tagged & { children: Node[]; takes?: string };

export type DropRequest = {
  node: Node;
  client: Point;
  scale: number;
  pointer?: Point;
};
export type PlaceRequest = {
  node: Node;
  fields: Record<string, unknown>;
  at?: number;
};

export const Drop = message<DropRequest, Node["url"] | undefined>(
  `${url}#drop`,
);
export const Pan = message<{ delta: Point }, void>(`${url}#pan`);
export const Place = message<PlaceRequest, void>(`${url}#place`);
export const Remove = message<{ node: Node }, boolean>(`${url}#remove`);
export const Taker = message<{ node: Node }, Node | undefined>(`${url}#taker`);

export const cards = [
  card({
    id: "container",
    title: "Container",
    description:
      "Places, removes, and claims children for anything tagged container.",
    matches: tags.container,
    accepts: [Place, Remove, Taker],
    behavior: () => import("./container.tsx"),
  }),
  card({
    id: "canvas",
    title: "Canvas",
    description:
      "A surface in plain pixels. Positions its children; each child draws itself.",
    matches: tags.canvas,
    accepts: [Drop, Pan, Place],
    behavior: () => import("./canvas.tsx"),
  }),
];
```

`packageUrl` reads the package's Automerge URL from the module's own URL; see [Loading code](#loading-code). The result has no heads, so two versions of the same package that are loaded at the same time produce equal tags and messages.

### Cards

A card document names a package and a descriptor. Title, description, and tag come from the descriptor at run time, so the document stays small:

```ts
type Card = Shape & {
  package: Node; // the package document
  card: string; // a descriptor id in that package's `cards`
  example?: Node; // an instance to drag out as a copy
};
```

The `card` card (the one that renders every card) reads the descriptor through the dealer and shows its title and description.

### Tags and messages

Documents store fully qualified tags. A tag such as `automerge:3RFhQ…#shape` is put at `@tags/automerge:3RFhQ…#shape`. The separator is `#` rather than `/` because `State.put` splits paths on `/`, and because a string with a fragment is not a valid Automerge URL, so `hydrate` won't turn it into a `Node`.

Host-level tags that don't belong to any package stay bare: `card`, `package`. The `template` tag moves into the package that holds the select and card behaviors, because it's their protocol.

Source code never spells a qualified tag. It imports the tag from the package that owns it:

```tsx
import { tags as shapes } from "shapes";

Node.create<Line>({
  "@tags": { [shapes.shape]: true, [tags.line]: true },
  …
});
```

### Dependencies between packages

A package depends on another by listing its Automerge URL in `package.json`:

```json
{
  "name": "lines",
  "main": "index.tsx",
  "dependencies": {
    "shapes": "automerge:3RFhQ8vNwJmU7Ki5yX2bHdLpTcE9"
  }
}
```

Source imports the dependency by its alias, as it would import an npm package:

```tsx
import { Drop, tags as shapes, type Point } from "shapes";
import { Child } from "shapes/render.tsx";
```

Dependencies are live: the import resolves to whatever the dependency's document currently contains. When `shapes` changes, every package that depends on it is reloaded. This is the right default for tags and messages, because the sender and the handler must agree on the current definition, not the one the sender was compiled against.

Packages must form a DAG. A cycle between packages is an error at load time. Cycles between files inside one package are allowed, with ES module semantics.

### Loading code

Package code loads as real ES modules. A service worker serves a package document at

```
https://<origin>/<encodeURIComponent(packageUrl)>/<path>
```

The service worker holds no repo. When a request misses its cache, it broadcasts a handoff message on a `BroadcastChannel`, and a tab that holds the repo answers it. The tab resolves the path in the package document, compiles TSX to JavaScript, writes the response into the service worker's cache, and replies. This is the protocol in `patchwork-next/core/bootloader`; the service worker itself is repo-agnostic and can be reused.

The responder does the following for each request:

1. If the URL has no heads, redirect (307) to the same path with the document's current heads. The ES module map is then keyed by an exact version.
2. Resolve the path in the package document.
3. If the file is TSX, compile it with Babel using the Solid preset and the TypeScript preset, emitting ES modules. Don't apply `transform-modules-commonjs`; `import.meta.url` must stay a real URL.
4. Rewrite bare imports that match a key in `dependencies` to `/<encodeURIComponent(dependencyUrl)>/`, with the dependency's `main` appended when the specifier has no subpath. Leave other bare imports for the import map.
5. Return the result as `text/javascript`.

The host provides an import map that maps `core`, `dom`, `solid-js`, `solid-js/web`, `solid-js/store`, and `maplibre-gl` to modules the host bundle emits. A package must use the host's instance of these, or reactivity breaks; the import map guarantees it.

`core` exports the function that turns a module URL back into a package URL:

```ts
export function packageUrl(moduleUrl: string): AutomergeUrl {
  const encoded = new URL(moduleUrl).pathname.split("/")[1];
  const { documentId } = parseAutomergeUrl(
    decodeURIComponent(encoded) as AutomergeUrl,
  );
  return stringifyAutomergeUrl({ documentId });
}

export function tag(pkg: AutomergeUrl, name: string): string {
  return `${pkg}#${name}`;
}
```

Pinned URLs give each version its own module instance. Stripping the heads in `packageUrl` gives every version the same tags and messages. Code identity is pinned; protocol identity is not.

### Sharing behavior through messages

Nothing a package can import may read or write a document or walk the tree. The helpers in `container.tsx` move as follows:

| Today                                        | Proposed                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `placeIn(state, node, …)`                    | `request(Place, { node, fields, at })`, handled by the container card            |
| `removeFrom(state, node)`                    | `request(Remove, { node })`, handled by the container card                       |
| `taker(from, node)`                          | `from.request(Taker, { node })`; each container answers itself or calls `next()` |
| `myPointer(node)`                            | `request(MyPointer)`, answered at the root by presence                           |
| `View`, `Child`                              | Stay as imports, in a `render` module                                            |
| `hit`, `elementOf`, `elementAt`, `isControl` | Stay as imports, in `dom`                                                        |

`View`, `Child`, and the `dom` helpers have no document state and no version ambiguity, so they belong with `solid-js` rather than with the protocol. The `view` field that `View` reads becomes a runtime contract owned by `render`, not a field that `canvas.tsx` happens to declare.

The container card is applied to every node tagged `container`. A canvas, a map, or a deck tags itself `container` and handles `Drop` by converting coordinates and sending `Place`:

```tsx
// src/packages/shapes/canvas.tsx
import { State, type Behavior } from "core";
import { elementOf } from "dom";
import { Drop, Place, tags } from "./index.tsx";

export default (({ url, request, on }) => {
  request(State).put({
    [`@tags/${tags.container}`]: true,
    [`@tags/${tags.surface}`]: true,
    takes: tags.shape,
    view: () => <CanvasView … />,
  });

  on(Drop, ({ node, client, scale }) => {
    const origin = elementOf(url)!.getBoundingClientRect();
    request(Place, {
      node,
      fields: { x: client.x - origin.left, y: client.y - origin.top, scale },
    });
    return url;
  });
}) satisfies Behavior;
```

Two side effects of this move:

- **Attribution.** Today the child's `change` inside `placeIn` is attributed to the requester. As a handler, it is attributed to the container card. This is arguably more accurate.
- **Batching.** The select tool wraps `removeFrom` and `Drop` in one `batch`. Messages dispatch synchronously, so the batch still covers both, but the handler can't see the batch boundary.

The container's `accepts` field is renamed `takes` so that `accepts` is free for messages; see the next section.

### Declaring accepted messages

A card descriptor lists the messages its behavior may register handlers for:

```ts
card({
  id: "pen",
  …
  accepts: [PointerDown, PointerMove, PointerUp, Toggle],
  behavior: () => import("./pen.tsx"),
});
```

The declaration covers handlers on any node, not only the card's own node. The pen registers `PointerDown` on the pointer, so it declares `PointerDown` even though it never handles that message on itself.

Enforcement happens in `Node.on`. The dealer passes the descriptor to `attach`, and the scope records its accepted messages:

```ts
attach = (behavior: Behavior, card?: { url: AutomergeUrl; accepts: Message<any, any>[] }) =>
  createRoot((dispose) => {
    const scope: Scope = {
      process: card?.url,
      accepts: card && new Set(card.accepts),
      owner: getOwner(),
      nodes: new Map(),
    };
    …
  });

on = <Req, Res>(msg: Message<Req, Res>, handler: Handler<Req, Res>): void => {
  if (this.scope.accepts && !this.scope.accepts.has(msg))
    throw new Error(`${this.scope.process} doesn't declare ${msg}`);
  …
};
```

The dealer's existing `try`/`catch` around `attach` reports the error as a failed card. Host behaviors attach without a descriptor and are unrestricted.

At the type level, `card()` narrows the `on` method of the node the behavior receives to the declared messages. Nodes reached through `parent`, `rootOf`, or a message response keep the unrestricted type; the runtime check covers them. Making `Node` generic in its accept list is possible later if the gap matters in practice.

The declaration also lets the runtime do two things it can't do today:

- The registry records which card registered each handler, so the inspector can show, per node, which messages are answered and by which card.
- `dispatch` can distinguish "bubbled past nodes that don't declare this message" from "reached a node that declares it and nothing is registered", and warn about the second in development.

## Example: two packages

### `shapes`

Owns the container protocol, the canvas, and the generic container behavior. Its entry module is shown in [Entry module](#entry-module).

```tsx
// src/packages/shapes/container.tsx
import { hasTag, State, type Behavior } from "core";
import { Place, Remove, Taker, type Container } from "./index.tsx";

export default (({ request, on }) => {
  const me = () => request(State).read<Container>();

  on(Taker, ({ node }, next) => {
    const takes = me().takes;
    return takes && hasTag(node, takes) ? me() : next();
  });

  on(Place, ({ node, fields, at }) => {
    request(State).change((d) => {
      // the body of placeIn
    });
    …
  });

  on(Remove, ({ node }) => {
    // the body of removeFrom
  });
}) satisfies Behavior;
```

### `lines`

Depends on `shapes`. Owns the line shape and the pen tool.

```json
{
  "name": "lines",
  "main": "index.tsx",
  "dependencies": {
    "shapes": "automerge:3RFhQ8vNwJmU7Ki5yX2bHdLpTcE9",
    "tools": "automerge:4KpLm2wQxYvRt8Jn6Hc3BdSfGeU7"
  }
}
```

```tsx
// src/packages/lines/index.tsx
import { card, packageUrl, tag } from "core";
import { Drop, type Point, type Shape } from "shapes";
import { PointerDown, PointerMove, PointerUp, Toggle } from "tools";

export const url = packageUrl(import.meta.url);
export const tags = { line: tag(url, "line"), pen: tag(url, "pen") };

export type Line = Shape & { points: Point[]; color: string; width: number };

export const cards = [
  card({
    id: "line",
    title: "Line",
    description: "Draws a polyline through its points.",
    matches: tags.line,
    accepts: [],
    behavior: () => import("./line.tsx"),
  }),
  card({
    id: "pen",
    title: "Pen",
    description: "A tool that draws lines onto whatever surface you press.",
    matches: tags.pen,
    accepts: [PointerDown, PointerMove, PointerUp, Toggle],
    behavior: () => import("./pen.tsx"),
  }),
];
```

```tsx
// src/packages/lines/pen.tsx
import { hasTag, Node, State, type Behavior } from "core";
import { hit } from "dom";
import { Drop, tags as shapes } from "shapes";
import { MyPointer, PointerDown, PointerMove, PointerUp } from "tools";
import { tags, type Line } from "./index.tsx";

export default (({ url, request }) => {
  …
  function start(e: PointerInput) {
    const surface = surfaceOf(hit(root, e.element)) ?? root;
    const line = Node.create<Line>({
      "@tags": { [shapes.shape]: true, [tags.line]: true },
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }],
      color: "#1d1d1f",
      width: 2,
    });
    surface.request(Drop, { node: line, client: e.client, scale: 1 });
    request(State).put({ stroke: line.url, from: e.client });
  }
}) satisfies Behavior;

function surfaceOf(node: Node): Node | undefined {
  for (let n: Node | undefined = node; n; n = n.parent)
    if (hasTag(n, shapes.surface)) return n;
  return undefined;
}
```

The pen declares no `Drop` in `accepts`, because it sends `Drop` and never handles it. Sending is not restricted.

## Host changes

### `core`

- Add `packageUrl`, `tag`, and `card`.
- Add `accepts` to `Scope` and the check in `Node.on`.
- Record the registering process on each registry `Entry`.

### `compile.ts`

Replace the synchronous `compile(source)` with a module loader:

- `importPackage(url)` resolves the package's current heads, builds the pinned URL, and calls `import()`. On failure, it retries once under a URL with a distinct query string, because the ES module map memoizes failed imports.
- A handoff responder listens on the `BroadcastChannel`, resolves paths in package documents, compiles TSX, rewrites dependency specifiers, and writes to the cache.

### `dealer.ts`

- For each node tagged `card`, read `package` and `card`, import the package's entry at its current heads, and look up the descriptor.
- Match nodes against the descriptor's `matches` tag, as today.
- Attach with the descriptor, so that `accepts` is enforced.
- Key attachments on the package's heads and the heads of every transitive dependency, replacing `hash(source)`. When any of those change, dispose the attachment and re-import.
- Attaching becomes asynchronous. A card is pending from the time its node appears until its module loads; the dealer puts nothing on the target in the meantime.

### `container.tsx`

Dissolve the module. `View` and `Child` move to `render.tsx`. `placeIn`, `removeFrom`, `taker`, and `myPointer` become messages as described in [Sharing behavior through messages](#sharing-behavior-through-messages).

### Build

- Emit `core`, `dom`, `render`, and the Solid and MapLibre modules as separate entries, and write an import map into `index.html`.
- Register the service worker at startup. During development, Vite serves the host; the service worker intercepts only paths whose first segment decodes to an `automerge:` URL.

### `tsconfig.json`

Map each package alias to its folder, so that `tsc` checks cross-package imports:

```json
"paths": {
  "core": ["./src/core/index.ts"],
  "dom": ["./src/dom.ts"],
  "render": ["./src/render.tsx"],
  "shapes": ["./src/packages/shapes/index.tsx"],
  "shapes/*": ["./src/packages/shapes/*"],
  "lines": ["./src/packages/lines/index.tsx"]
}
```

## Migration

Each step leaves the application working.

1. **Service worker and loader.** Add the service worker, the handoff responder, the import map, and `importPackage`. Load one existing card through it, with its source wrapped as a single-file package, to prove the path works.
2. **Package documents.** Move `src/cards/*.tsx` into `src/packages/*/`, add entry modules, and change the seed to upload packages. Change the dealer to import entries and read descriptors. Delete the duplicated `message(...)` declarations.
3. **Qualified tags.** Switch `@tags`, `matches`, and `takes` to qualified strings. Existing canvases are not migrated; a new canvas is seeded.
4. **Messages for behavior.** Add the container card. Replace calls to `placeIn`, `removeFrom`, `taker`, and `myPointer` with messages. Delete `container.tsx`.
5. **Accepted messages.** Add `accepts` to every descriptor and the check in `Node.on`.

## Open questions

**Pinned dependencies.** `dependencies` holds plain URLs, so dependencies are live. A package that wants to freeze a dependency could use a URL with heads. The cost is that it then compiles against an old contract while the tree runs the new one, so the two can disagree on a message's request shape. Decide whether to allow this at all.

**Who answers the handoff.** With several tabs open, every tab that holds the repo answers every request. The first `cache.put` wins and the rest are redundant. This is harmless but wasteful. Options are a leader election over the same channel, or moving the repo to a shared worker as Patchwork does.

**Typed tags.** `tags` is `Record<string, string>` at the type level. A generated declaration file per package would make `tags.shape` a literal type, which would let `hasTag` and `matches` reject unknown tags at compile time. Not needed until there's an in-app editor.

**Generic `Node`.** Whether to make `Node` generic in its accepted messages so that `pointer.on(Drop, …)` is a type error in a card that doesn't declare `Drop`. The runtime check covers this; the type-level version touches every helper that returns a node.

## Alternatives considered

**A virtual `package` module.** The compiler injects a module that exports the package's URL and tags. Rejected because it requires a compile step that knows which package a file belongs to, and because it can't be expressed in the repository's TypeScript without a shim. Deriving the URL from `import.meta.url` needs neither.

**A manifest in `package.json`.** Cards, tags, and messages described in JSON, with source aliases such as `"shapes/shape"` resolved against `dependencies`. Rejected because it introduces a second namespace that must be kept in sync with the code, and because message types can't be expressed in JSON. Descriptors in the entry module give the same information with one source of truth.

**Per-card `imports` map.** Each card document lists the cards it imports, by alias, and `require` resolves aliases through the document. Rejected because it ties dependencies to cards rather than to code, so two cards from the same codebase would declare the same imports twice.

**Keep `placeIn` as an import.** Simplest, but it leaves two ways to share behavior and means the host decides what a container is. Making it a message lets a package define containers the host has never seen.

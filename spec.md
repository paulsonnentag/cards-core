# Packages, cards, and messages

Status: implemented
Scope: `core/` and `site/` in this repository (`cards-core`), and the packages in `cards-packages`. Code loading (`loader/`) is specified separately in [loader-spec.md](loader-spec.md).

## Summary

This document describes three changes to how code is organized and shared in Cards:

- Split **packages** from **cards**. A package is an Automerge document that holds published code and is the unit of code and dependencies. A card is a node in the tree that activates one behavior from a package.
- Share behavior only through **messages**. Helpers that read or write documents, such as `placeIn`, are no longer imported: a card writes the documents whose meaning it owns, and asks other cards through messages. Packages share types, tags, and message definitions through ordinary JavaScript imports.
- Load package code as real ES modules through the [package loader](loader-spec.md), so that a module can derive the package it belongs to from `import.meta.url`. Tags and messages are then qualified by the package URL without a compiler step or a virtual module.

A fourth, smaller change follows from the first three: a card declares which messages it accepts, and the runtime rejects handlers for anything else.

## Goals

- One mechanism for sharing: imports carry contracts, messages carry behavior.
- One definition per message and per tag. Before this change `Drop` was declared in five files and `PointerDown` in four, and they agreed only because they spelled the same string.
- Tags that are owned by a package, so that two packages can both define `line` without colliding.
- Live dependencies. When a package changes, the cards that depend on it are re-attached with the new code, as the dealer already did for a single card's source.
- No change to the message protocol itself. `dispatch`, `on`, and `request` keep their semantics.

## Non-goals

- An in-app code editor. This design makes one possible but doesn't include it.
- Pinned dependency versions at run time. The lockfile pins what a package is type-checked against; the page always runs the latest version of every package. See [Open questions](#open-questions).
- Moving the Automerge repo into a shared worker. The service worker design permits it, but the responder runs in the tab.

## Background

Cards were stored as documents whose `source` field was TSX. The dealer compiled that source with Babel in the browser and attached the resulting behavior to every node that carried the card's `matches` tag. A card could import from a fixed set of host modules (`compile.ts`):

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

This led to two splits that were hard to reason about:

1. **Behavior was shared two ways.** `container.tsx` exported `placeIn`, `removeFrom`, `taker`, and `myPointer`. These functions read and write documents and walk the tree, so they were the container protocol in function form, while `Drop` and `Pan` were the same protocol in message form. `taker` was the `dispatch` ancestor walk written by hand.
2. **Contracts were defined in cards but couldn't be imported from them.** `Shape`, `Container`, `DropRequest`, and `PointerInput` lived in card files. The host imported them as types, but a card couldn't import another card at run time, so every card re-declared the message constants it used.

Patchwork ([`patchwork-next`](../patchwork-next)) solves the loading half of this problem with a service worker that serves Automerge documents over HTTP, pins module URLs to document heads, and uses an import map for host libraries. The [package loader](loader-spec.md) adopts that approach.

## Terminology

**Package**
: An Automerge document published from a package folder: `package.json`, `src/`, the transpiled `dist/`, and `importmap.json`. The unit of code, dependencies, and tag ownership.

**Card**
: A node in the tree that names one card descriptor of a package. The unit of dealing: the dealer attaches the descriptor's behavior to every node carrying the descriptor's tag.

**Card descriptor**
: An object exported by a package's entry module that describes one card: its title, the tag it matches, the messages it accepts, and its behavior.

**Tag**
: A string of the form `<package URL>#<name>`. Owned by the package whose URL it carries.

**Message**
: A string of the form `<package URL>#<name>`, typed with a request and a response by `message<Req, Res>()`.

**Host**
: The code bundled with the application: `@cards/core`, the loader, and the site, which holds the dealer, presence, and the seed in `main.tsx`.

## Design

### Repository layout

Two repositories, checked out next to each other. `cards-core` (this one) is a pnpm workspace used from source:

```
loader/   @cards/loader   the package loader, its Vite plugin, the pnpm resolver, and cards-importmap
core/     @cards/core     nodes, messages, the backend; also @cards/core/render
site/     @cards/site     the page: repo, loader, dealer, presence, and the seed
```

`cards-packages` is not a workspace. Each folder in it is a package on its own (`@cards/shapes`, `@cards/tools`, `@cards/lines`, `@cards/deck`, `@cards/map`) that installs, builds, and pushes by itself, so a folder can be copied out and worked on alone. Its README describes the one-time machine setup. `core` is part of the page's environment, so a package imports it under its own name and gets the page's instance.

### Packages

A package is a folder, published as one document with pushwork:

```
shapes/
  package.json
  tsconfig.json            self-contained, no extends
  babel.config.json        the Solid and TypeScript presets
  .pushworkattributes      which files are pinned with heads
  src/index.ts             the entry module
  src/canvas.tsx
  .pushwork/config.json    the package's document URL, committed
```

`package.json` is an ordinary npm manifest. `exports["."]` names the transpiled entry, and `packageManager` pins pnpm 12. The peer dependencies are the parts of the environment it uses, `@cards/core` and `solid-js`. `@cards/core` is also a dev dependency, linked from a `cards-core` checkout (`link:../../cards-core/core`), so the package type-checks against core's source. Everything that describes cards, tags, and messages is code in the entry module.

```json
{
  "name": "@cards/shapes",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@12.15.0",
  "exports": { ".": "./dist/index.js" },
  "types": "./dist/index.d.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "babel src -d dist -x .ts,.tsx --copy-files --delete-dir-on-start && tsc && cards-importmap",
    "push": "pnpm build && pushwork sync"
  },
  "peerDependencies": { "@cards/core": "*", "solid-js": "*" },
  "devDependencies": {
    "@babel/cli": "^7.28.0",
    "@babel/core": "^7.28.0",
    "@babel/preset-typescript": "^7.27.0",
    "@cards/core": "link:../../cards-core/core",
    "babel-preset-solid": "^1.9.16",
    "solid-js": "^1.9.17",
    "typescript": "^7.0.2"
  }
}
```

`pnpm install` and then `pnpm push` publish a package: transpile, emit declarations, generate the import map, and sync with pushwork. See [Publishing](loader-spec.md#publishing).

### Entry module

The entry module is a package's public surface. It exports types, tags, messages, and card descriptors. It does not contain behavior.

```tsx
// packages/shapes/src/index.ts
import {
  card,
  message,
  packageUrl,
  tag,
  type Node,
  type Tagged,
} from "@cards/core";
import type { Viewed } from "@cards/core/render";

export const url = packageUrl(import.meta.url);

export const tags = {
  shape: tag(url, "shape"),
  surface: tag(url, "surface"),
  canvas: tag(url, "canvas"),
};

export type Point = { x: number; y: number };
export type Shape = Tagged & Viewed & { x: number; y: number; scale?: number };
export type Container = Tagged & { children: Node[]; takes?: string };

export type DropRequest = {
  node: Node;
  client: Point;
  scale: number;
  pointer?: Point;
};

export const Drop = message<DropRequest, Node["url"] | undefined>(
  `${url}#drop`,
);

export const cards = [
  card({
    id: "canvas",
    title: "Canvas",
    description:
      "A surface in plain pixels. Positions its children; each child draws itself.",
    matches: tags.canvas,
    accepts: [Drop],
    behavior: () => import("./canvas.js"),
  }),
];
```

`packageUrl` reads the package's Automerge URL from the module's own URL; see [Loading code](#loading-code). The result has no heads, so two versions of the same package that are loaded at the same time produce equal tags and messages.

### Cards

A card document names a package and a descriptor in one string, `tag(package, id)`. Title, description, and tag come from the descriptor at run time, so the document stays small:

```ts
type Card = Tagged & {
  card?: string; // `${packageUrl}#${descriptor id}`
  example?: Node; // an instance to drag out as a copy
};
```

The reference is a string rather than a node. A node would make the package document a child in the tree, and every walk would descend into its files. Like a tag, a URL with a fragment isn't a valid Automerge URL, so the backend leaves it a string.

The `card` card (the one that renders every card) and the deck read the descriptor with `request(Describe)`, which the dealer answers at the root for the card that asks.

A descriptor can make its card's example. `example` gets a node to send from and returns a new node, which the seed stores in the card document:

```ts
type CardDescriptor = {
  …
  example?: (node: Node) => Node;
};

card({
  id: "deck",
  …
  example: ({ request }) =>
    request(NewNode, {
      "@tags": { [shapes.shape]: true, [tags.deck]: true },
      x: 0,
      y: 0,
      children: [],
    } satisfies Deck),
});
```

### Creating nodes

`NewNode` creates a document and answers with its node in the requester's scope. The backend answers it at the root:

```ts
const NewNode = message<Record<string, unknown>, Node>("core/new-node");
```

The document is stored at once and the change is attributed to the card that sent the message. Nodes anywhere in the initial value, inside plain objects and arrays, are stored as their URLs, so a document can be created with others nested in it:

```ts
request(NewNode, {
  "@tags": { user: true },
  pointer: request(NewNode, { "@tags": { … }, x: 0, y: 0 }),
});
```

A new node has no parent until a document references it, for example after `Drop` or `d.children.push(node)` inside a change. One that is never placed stays in the repo, unreferenced. `State.clone()` and `Lookup` with `orCreate` create documents the same way.

### Tags and messages

Documents store fully qualified tags. A tag such as `automerge:3RFhQ…#shape` is put at `@tags/automerge:3RFhQ…#shape`. The separator is `#` rather than `/` because `State.put` splits paths on `/`, and because a string with a fragment is not a valid Automerge URL, so `hydrate` won't turn it into a `Node`.

Host-level tags that don't belong to any package stay bare: `card` and `user`. The `template` tag moves into the `tools` package, which holds the select and card behaviors, because it's their protocol.

Source code never spells a qualified tag. It imports the tag from the package that owns it:

```tsx
import { tags as shapes } from "@cards/shapes";

request(NewNode, {
  "@tags": { [shapes.shape]: true, [tags.line]: true },
  …
} satisfies Line);
```

### Dependencies between packages

A package depends on another by listing its Automerge URL in `package.json`:

```json
{
  "name": "@cards/lines",
  "dependencies": {
    "@cards/shapes": "automerge:atho8JGpgB4mZnR6pP4LYffh1XT",
    "@cards/tools": "automerge:qFzm3sVaVsAqZ3ZjdhCSNzkQoJK"
  }
}
```

pnpm installs it from the document through the loader's resolver, which every project on the machine gets as pnpm's `globalPnpmfile`. `tsc` checks the dependent against the dependency's published `dist/*.d.ts`, and the lockfile records the heads. What makes it a package dependency is the `automerge:` specifier, not the name; a neighbouring folder is never linked. Source imports the dependency by its alias, as it would import an npm package:

```tsx
import { Drop, tags as shapes, type Point } from "@cards/shapes";
```

Dependencies are live at run time: the loader pins every package in a closure to its latest heads when it loads, and reloads when any of them changes. This is the right default for tags and messages, because the sender and the handler must agree on the current definition, not the one the sender was type-checked against.

Packages form a DAG, because a package has to be published before another package can install it.

### Loading code

The dealer gets package code from the [package loader](loader-spec.md). `loader.watch(url, callback)` delivers a package's entry module and delivers it again whenever the package or anything it depends on changes. Each module is loaded natively from a pinned same-origin URL that the service worker serves from the repo.

The host provides the environment, the bare specifiers every package shares with the page: `solid-js`, `solid-js/web`, `solid-js/store`, `@automerge/automerge-repo`, `@cards/core`, and `@cards/core/render`. A package must use the host's instance of these, or reactivity breaks. The loader's Vite plugin emits each one as a module that re-exports the host's instance, and `createLoader` installs the import map for them. npm dependencies such as `maplibre-gl` belong to the package that uses them and load from jspm.io through that package's import map.

`@cards/core` reads the package from the loader's pinned prefix with its own copy of `packageUrl`, so it doesn't depend on the loader:

```ts
export function packageUrl(moduleUrl: string): AutomergeUrl {
  const [segment] = new URL(moduleUrl).pathname.split("/")[1].split("@");
  return decodeURIComponent(segment).split("#")[0] as AutomergeUrl;
}

export function tag(pkg: AutomergeUrl, name: string): string {
  return `${pkg}#${name}`;
}
```

Pinned URLs give each version its own module instance. Stripping the heads in `packageUrl` gives every version the same tags and messages. Code identity is pinned; protocol identity is not.

### Sharing behavior through messages

Nothing a package can import may read or write a document or walk the tree. The helpers in `container.tsx` moved as follows:

| Before                                 | Now                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `placeIn(state, node, …)`              | each container adds to its own `children` when it handles `Drop`                                  |
| `removeFrom(state, node)`              | the select tool takes a lifted node out of its container                                          |
| `taker(from, node)`                    | a local function in the select tool that walks `.parent` and reads `takes`                        |
| `myPointer(node)`                      | `request(MyPointer)`, answered at the root by presence                                            |
| reading `me` and `present` on the root | `request(Pointers)`, answered at the root by presence                                             |
| `View`, `Child`                        | Stay as imports, in `@cards/core/render`                                                          |
| `hit`, `isControl`                     | Gone: the pointer reports the url of the node under it, and a control keeps its press itself      |
| `elementOf`, `elementAt`               | Gone: a card measures only its own elements, through refs, and the pointer finds what is under it |
| `Pan`                                  | Gone: the map pans itself while the select tool is selected                                       |

`View` and `Child` have no document state and no version ambiguity, so they belong with `solid-js` rather than with the protocol. The `view` field that `View` reads is a runtime contract owned by `@cards/core/render` (`Viewed`), not a field that `canvas.tsx` happens to declare. `MyPointer` and `Pointers` answer with nodes in the requester's scope, so cards never read users.

`children` is plain data: `walk` and `childNodes` find nodes in any field. A canvas, a map, or a deck declares what it takes with `takes`, and handles `Drop` by converting the screen point into its own terms, through a ref to its own frame, and adding the node to its own `children`. It answers with its url to say the node is in; a `Drop` nobody answers bubbles up to the root canvas.

```tsx
// packages/shapes/src/canvas.tsx
export default (({ url, request, on }) => {
  const canvas = () => request(State).read<Canvas>();
  let frame: HTMLElement | undefined;

  request(State).put({
    [`@tags/${tags.surface}`]: true,
    takes: tags.shape,
    view: () => <CanvasView … frame={(el) => (frame = el)} />,
  });

  on(Drop, ({ node, client, scale }) => {
    const origin = frame!.getBoundingClientRect();
    request(State).change((d: Canvas) => {
      if (!d.children) d.children = [];
      d.children.push(node);
    });
    const child = canvas().children.find((c) => c.url === node.url)!;
    child.request(State).change((d: Shape) => {
      d.x = client.x - origin.left;
      d.y = client.y - origin.top;
      d.scale = scale;
    });
    return url;
  });
}) satisfies Behavior;
```

The other half of a move is the select tool's: on lift it removes the node from its container's `children`, the one place a node leaves one. A template stays where it is and the tool lifts a clone instead.

The container's `accepts` field is renamed `takes` so that `accepts` is free for messages; see the next section.

### Drag and drop

Only the pointer looks at the whole page's DOM. Every other card measures only its own elements, through refs. With every pointer event the pointer reports the url of the innermost node under it (the nearest `data-node`, looking through anything held), which a tool binds in its own scope with `nodeIn`:

```ts
type PointerInput = {
  client: Point;
  target: Node["url"]; // the root, if nothing else is under the pointer
  grab?: { at: Point; scale: number }; // on PointerDown: where on the target, in its own pixels, and its scale on screen
  claimedBy?: Node["url"];
};
```

Who gets a press is settled by claims, and the pointer knows nothing about tools:

- **A press the page keeps.** A view that handles a press itself calls `preventDefault` on `pointerdown`, and the pointer doesn't emit it. The map does this to pan.
- **A claim for one press.** A `PointerDown` or `PointerMove` handler returns its url instead of calling `next()`. The pointer puts it as `claimedBy`, captures the pointer, and swallows the click that ends the press. The select tool and the pen claim on the first move past a small threshold, not on the press, so a click still reaches what was clicked, buttons included.
- **A standing claim.** A tool puts its url as `claimedBy` on the pointer for as long as it wants every press. The pointer then takes each press before the page sees it, except presses on the claiming tool's own view, and swallows its click. The inspector holds one while it is selected, so it can pick a button without pressing it. Picking switches it off.

The pointer listens on the window, in the capture phase for standing claims and in the bubble phase for everything else. Solid delegates events to the document, so only the window sees a press before and after every view's handlers.

A drag is shared through the pointer's puts, which presence sends to everyone with the canvas open: `holding`, `grip` (where the node was grabbed, its scale, and `over`, the container that would take it), and `position`, on the root surface, which means the same in every tab. The pointer card also puts `client`, a function that turns `position` into this screen's coordinates. Like a view it stays in its tab, so every tab works it out for every pointer it shows.

A container shows a drop before it happens by reading `Pointers`: for each pointer whose `grip.over` is itself, it converts `client()` through its own ref. The deck opens a slot at the row under it and the map highlights, for anyone's drag.

The select tool owns the gesture:

1. **Press.** Remember the target and `grab`, without claiming.
2. **Lift**, past four pixels. Claim the press, take the node out of its container (or clone a template), and put it in the pointer's hand. The root can't be lifted.
3. **Move.** Walk up from the target to the nearest container whose `takes` the held node carries; put it in `grip.over`.
4. **Release.** Send `Drop` to `grip.over`, or to the root.

### Declaring accepted messages

A card descriptor lists the messages its behavior may register handlers for:

```ts
card({
  id: "pen",
  …
  accepts: [PointerDown, PointerMove, PointerUp],
  behavior: () => import("./pen.js"),
});
```

The declaration covers handlers on any node, not only the card's own node. The pen registers `PointerDown` on the pointer, so it declares `PointerDown` even though it never handles that message on itself. It sends `Toggle` and `Drop` but handles neither, so it declares neither. Sending is not restricted.

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
  const { accepts, process } = this.scope;
  if (accepts && !accepts.has(msg))
    throw new Error(`card ${process} handles ${msg} without accepting it`);
  …
};
```

The dealer reports the error as a failed card. Host behaviors attach without a descriptor and are unrestricted.

The check is runtime only. `card()` doesn't narrow the type of `on`, because message types are structurally interchangeable strings; see [Generic `Node`](#open-questions).

The registry records which card registered each handler (`Entry.process`). That makes two things possible that weren't before:

- The inspector can show, per node, which messages are answered and by which card.
- `dispatch` can distinguish "bubbled past nodes that don't declare this message" from "reached a node that declares it and nothing is registered", and warn about the second in development.

## Packages in this repository

| Package         | Depends on                       | Cards                                  | Owns                                                                 |
| --------------- | -------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| `@cards/shapes` |                                  | canvas                                 | `Shape`, `Container`, the container protocol                         |
| `@cards/tools`  | `shapes`                         | card, pointer, tool, select, inspector | pointer events, `Toggle`, the `tool`, `default`, and `template` tags |
| `@cards/lines`  | `shapes`, `tools`                | line, pen                              | `Line`                                                               |
| `@cards/deck`   | `shapes`, `tools`                | deck                                   | `Deck`                                                               |
| `@cards/map`    | `shapes`, `tools`, `maplibre-gl` | map                                    | `MapShape`, `Camera`                                                 |

Examples: select and inspector are a bare shape with their tool's tag, the pen a shape tagged `pen`, the line a zigzag, the deck empty, and the map 300 by 200 pixels over Berlin. Canvas, card, pointer, and tool have none.

### `shapes`

Owns the container protocol and the canvas. Its entry module is shown in [Entry module](#entry-module), and the canvas in [Sharing behavior through messages](#sharing-behavior-through-messages).

### `lines`

Depends on `shapes` and `tools`. Owns the line shape and the pen tool.

```tsx
// packages/lines/src/index.ts
import { card, NewNode, packageUrl, tag } from "@cards/core";
import { tags as shapes, type Point, type Shape } from "@cards/shapes";
import { PointerDown, PointerMove, PointerUp } from "@cards/tools";

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
    behavior: () => import("./line.js"),
    example: ({ request }) =>
      request(NewNode, {
        "@tags": { [shapes.shape]: true, [tags.line]: true },
        x: 0,
        y: 0,
        points: [ … ], // a zigzag
        color: "#1d1d1f",
        width: 3,
      } satisfies Line),
  }),
  card({
    id: "pen",
    title: "Pen",
    description: "A tool that draws lines onto whatever surface you press.",
    matches: tags.pen,
    accepts: [PointerDown, PointerMove, PointerUp],
    behavior: () => import("./pen.js"),
    example: ({ request }) =>
      request(NewNode, {
        "@tags": { [shapes.shape]: true, [tags.pen]: true },
        x: 0,
        y: 0,
      } satisfies Shape),
  }),
];
```

```tsx
// packages/lines/src/pen.tsx
import { createMemo } from "solid-js";
import {
  hasTag,
  MyPointer,
  NewNode,
  rootOf,
  State,
  type Behavior,
  type Node,
} from "@cards/core";
import { Drop, tags as shapes } from "@cards/shapes";
import { PointerDown, PointerMove, PointerUp } from "@cards/tools";
import { tags, type Line } from "./index.js";

// Draws only once the pen moves, so a click still reaches what was clicked, buttons included
export default (({ url, parent, request }) => {
  const pointer = createMemo(() => request(MyPointer));
  …
  // the surface the pen went down on decides where the line lives
  function start() {
    const { from, on } = self().press!;
    const surface = surfaceOf(on) ?? rootOf(parent!);
    const line = request(NewNode, {
      "@tags": { [shapes.shape]: true, [tags.line]: true },
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }],
      color: "#1d1d1f",
      width: 2,
    } satisfies Line);
    surface.request(Drop, { node: line, client: from, scale: 1 });
    request(State).put("stroke", line.url);
  }
}) satisfies Behavior;

function surfaceOf(node: Node): Node | undefined {
  for (let n: Node | undefined = node; n; n = n.parent)
    if (hasTag(n, shapes.surface)) return n;
  return undefined;
}
```

### `map`

Brings its own npm dependency. `maplibre-gl` loads from jspm.io through the package's import map, and MapLibre finds its worker next to its own module URL. The map card adopts MapLibre's stylesheet for as long as it is attached, following the loader's [package conventions](loader-spec.md#package-conventions).

Dragging the map's background pans it, but only while the select tool is selected: the map finds the select tool with `Lookup` by its tag and reads `selected`, so it imports `tags` from `@cards/tools` at run time. While panning it calls `preventDefault` and captures the pointer itself, so no tool sees the press. With any other tool selected the press goes to the tool, so the pen draws on the map. Its children and MapLibre's controls keep their presses.

## Host

### `@cards/core`

- `packageUrl`, `tag`, `card`, and the `Card` and `CardDescriptor` types.
- `Describe`, answered by the dealer; `MyPointer` and `Pointers`, answered by presence; `NewNode`, answered by the backend.
- `accepts` on `Scope` and the check in `Node.on`.
- The registering process on each registry `Entry`.
- `@cards/core/render`, as described in [Sharing behavior through messages](#sharing-behavior-through-messages).

There is no `Node.create`. Documents are only created through the backend, which stores them at once.

### `site/src/dealer.ts`

- `dealer(loader)` returns the root behavior. For each node tagged `card`, it splits `card` into a package URL and a descriptor id, watches the package through the loader, and looks up the descriptor in the module's `cards`.
- It matches nodes against the descriptor's `matches` tag, as before.
- It attaches with the descriptor, so that `accepts` is enforced.
- Attachments are keyed on the descriptor's identity, replacing `hash(source)`. A new module from the loader means new descriptors, so every attachment made from the old module is disposed and re-made.
- Attaching is asynchronous: the descriptor's `behavior()` imports the behavior module on first use. If the attachment is disposed before the module arrives, it never attaches.
- It answers `Describe` at the root with the descriptor of the card that asks.

### `site/src/presence.ts`

Answers `MyPointer` and `Pointers` at the root, with nodes in the requester's scope.

### `site/src/main.tsx`

Opens the repo with Subduction (IndexedDB storage, a `BroadcastChannel` between tabs, and the Subduction sync server) and creates the loader with the environment from the Vite plugin. It opens the space named in the URL hash, or seeds a new one:

1. Create the canvas document with the repo, and attach the backend to it, so that `NewNode` has a root to be answered at.
2. For each package, `loader.load` its entry module and create a card document per descriptor in `cards`, with `card: tag(package, id)` and the descriptor's `example(root)`.
3. Lay out the canvas: the select tool (the default), the pen, the inspector, a deck holding every card, and a map of Berlin.

The package URLs come from `virtual:cards/packages`, provided by a plugin in `site/vite.config.ts` that reads each `../../cards-packages/*/.pushwork/config.json` at build time, from a checkout next to this repository. A folder that was never published isn't listed. The cards on the deck need no site change: a new package or a new descriptor shows up in the next seeded space. The layout is the one site-specific part. It names the tags it needs by package folder: `shapes` for the canvas, `tools` for the pointer and tools, `lines`, `deck`, and `map`.

The user is a document created with `NewNode`, with their pointer nested in it, and is kept per tab in `sessionStorage`.

### Build

`site/vite.config.ts` adds the loader plugin from `@cards/loader/vite` with the environment. The plugin serves the service worker in development and emits it, together with one module per environment specifier, in the build.

### TypeScript

In `cards-core`, `loader`, `core`, and `site` each have a `tsconfig.json` that extends `tsconfig.base.json` and a `typecheck` script; the root runs `pnpm -r typecheck`. A package in `cards-packages` has a self-contained `tsconfig.json` that also emits its declarations. It resolves `@cards/core` through its linked dev dependency, to core's source, and other packages through `node_modules`, as pnpm installed them from their documents. Published declarations import `@cards/core` by name, so a dependent checks them against its own copy of core.

## Migration

Existing canvases are not migrated: their card documents hold `source`, and their tags are bare. A new canvas is seeded from the published packages. To change a package, edit its folder and run `pnpm install && pnpm push` in it. Open pages pick up the new version without a reload. A new dependency goes into `package.json` as the dependency's document URL, under its `@cards/<name>` alias; push the dependency first.

## Open questions

**Pinned dependencies.** The page always runs every package at its latest heads, while `tsc` checks against the heads in the lockfile. A package can therefore run against a newer contract than it was checked against, and the two can disagree on a message's request shape. Running the locked heads instead would remove the drift, but then two packages could run different versions of one dependency, with the same tags and messages and different code. Decide whether to allow this at all.

**Who answers the handoff.** With several tabs open, every tab that holds the repo answers every request. The first `cache.put` wins and the rest are redundant. This is harmless but wasteful. Options are a leader election over the same channel, or moving the repo to a shared worker as Patchwork does.

**Typed tags.** `tags` is `Record<string, string>` at the type level. A literal type per tag would let `hasTag` and `matches` reject unknown tags at compile time. Not needed until there's an in-app editor.

**Generic `Node`.** Whether to make `Node` generic in its accepted messages, so that `pointer.on(Drop, …)` is a type error in a card that doesn't declare `Drop`. Messages would need a nominal brand first, since today any two messages with compatible request and response types are interchangeable to the type checker. The runtime check covers this; the type-level version touches every helper that returns a node.

## Alternatives considered

**A virtual `package` module.** The compiler injects a module that exports the package's URL and tags. Rejected because it requires a compile step that knows which package a file belongs to, and because it can't be expressed in the repository's TypeScript without a shim. Deriving the URL from `import.meta.url` needs neither.

**A manifest in `package.json`.** Cards, tags, and messages described in JSON, with source aliases such as `"shapes/shape"` resolved against `dependencies`. Rejected because it introduces a second namespace that must be kept in sync with the code, and because message types can't be expressed in JSON. Descriptors in the entry module give the same information with one source of truth.

**Per-card `imports` map.** Each card document lists the cards it imports, by alias, and `require` resolves aliases through the document. Rejected because it ties dependencies to cards rather than to code, so two cards from the same codebase would declare the same imports twice.

**Keep `placeIn` as an import.** Simplest, but it leaves two ways to share behavior and means the host decides what a container is.

**`Place`, `Remove`, and `Taker` as messages.** A generic container card, applied to anything tagged `container`, answered all three and was the one writer of `children`. Rejected because nothing ever overrode them: every container wanted the same list edit, so the messages were shared helpers in message form, and each surface's `Drop` handler still had to send `Place`. Writing `children` in the container that owns it, and taking a node out in the one tool that moves nodes, needs neither the card nor the messages.

**A drop preview in `grip`.** The select tool asks the container under the pointer where the node would land, on every move, and puts the answer in `grip`. Rejected because it needs a second mode for `Drop` that answers without placing. A pointer that tells every tab where it is on that tab's screen lets each container work the preview out itself.

**The package as a node in the card document.** `package: Node` next to `card: id`. Rejected because the tree walk then descends into the package document and every file in it.

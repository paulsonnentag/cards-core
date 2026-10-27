# Cards

Status: proposed. This document describes the next design of the tree. The sections on packages, messages, and loading describe what is implemented today and doesn't change.
Scope: `core/` and `site/` in this repository (`cards-core`), and the packages in `cards-packages`. Code loading is specified in [loader-spec.md](loader-spec.md).

## Overview

Cards is a shared canvas. Everything on it is a **node**: a shape, a map, a tool, a deck of cards, your pointer. A **card** adds behavior to nodes. You drag cards onto the canvas, and the nodes they match come alive.

The design rests on one distinction:

- A **document** is data. It's an Automerge document with a URL. Documents sync between everyone who has the canvas open.
- A **node** is a document placed somewhere. It has a parent, a name in that parent, and the cards dealt to it.

The same document can be placed twice. That gives you two nodes. They show the same data, but each one has its own name, its own cards, and its own temporary state.

## Layers

Three layers build on each other. Each one knows only about the layers below it.

| Layer        | Lives in           | Knows about                                                                                                                  |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Core**     | `@cards/core`      | Documents, nodes, paths, the three parts of a document, puts, symbols, cards as descriptors, rendering a node's `view`.      |
| **Host**     | `site/`            | The dealer and its reach rule, presence, the seed. The one place that names concrete tags from packages.                     |
| **Packages** | `cards-packages/*` | Everything you can see: shapes, embeds, surfaces, containers, tools, pointers, decks, maps. Each package owns its own ideas. |

A document has three parts: `value`, `children`, and `tags`. Core owns the parts. It never looks inside `value`. Everything in `value` belongs to whoever writes it, so packages don't need to avoid any reserved words.

Words like _surface_, _container_, _shape_, and _embed_ come from the `shapes` package. They aren't part of the model. This document uses them in examples and in the sections about packages.

## Terms

### Core

**Document**
: An Automerge document, named by its URL. Shared data, in three parts: `value`, `children`, and `tags`.

**Node**
: A document placed under a parent. Identified by its path.

**Name**
: The key a child has in its parent's `children`. Any string that isn't empty and has no `/`.

**Path**
: The names from the root to a node, joined with `/`. The root's path is `/`.

**Put**
: A temporary value on a node. Puts live in memory in one tab. They're never stored.

**Card**
: A node that names a card descriptor in a package. The dealer attaches the descriptor's behavior to every node the card reaches and matches.

**Behavior**
: The code a card runs on a node.

**Package**
: An Automerge document that holds published code: types, symbols, and card descriptors.

**Symbol**
: A string of the form `<package URL>#<name>`, owned by the package whose URL it carries. Tags and messages are symbols.

**Tag**
: A symbol in a document's `tags`. A node's tags decide which cards match it.

**Message**
: A symbol you send to a node, typed with a request and a response.

**Host**
: The code bundled with the page: `@cards/core`, the loader, and the site (the dealer, presence, and the seed).

### From `@cards/shapes`

**Shape**
: A node with a position of its own: `x`, `y`, `scale`, and `order` in its value. A sheep, a line, a hat.

**Embed**
: A shape that shows something that has no position of its own. It has a size and one child, named `of`. A map on a canvas is an embed with the map inside.

**Container**
: A node whose card draws its children. A canvas, a map, a deck, an embed, and a pointer are containers.

**Surface**
: A container that draws shapes at their positions: a canvas or a map.

## Documents and nodes

### Documents

A document is plain data. It has no parent and no behavior. The backend reads and writes documents through the Automerge repo.

Every document has the same shape:

```ts
type Doc<T = unknown> = {
  value: T; // userspace. Core never looks inside.
  children: Record<string, AutomergeUrl>; // name → child document
  tags: Record<string, true>; // the tags this document carries
};
```

`children` and `tags` are flat. `value` is anything a package wants, and core treats it as opaque.

You create a document with `NewNode`:

```ts
const doc = request(NewNode, {
  tags: { [shapes.shape]: true, [tags.line]: true },
  value: { x: 0, y: 0, points: [{ x: 0, y: 0 }] },
});
```

`NewNode` stores the document right away and returns a **detached node**: a node with a `url` but no path. You can read and change a detached node's document, and you can place it. Nothing is dealt to it and nothing draws it until it's placed.

A document that nothing places stays in the repo, unused.

### Nodes are places

A node is a document at a path. The path is its identity. Two nodes with different paths are different nodes, even when they show the same document.

Every node has:

| Property | What it is                                                    |
| -------- | ------------------------------------------------------------- |
| `url`    | The document it shows.                                        |
| `path`   | Its names from the root. Undefined for a detached node.       |
| `name`   | The last name in its path.                                    |
| `parent` | The node above it. Undefined for the root and detached nodes. |

Each node has its own puts, its own message handlers, its own element on screen, and its own cards. None of these are shared between two placements of one document.

### Children and names

A node's children are the entries in its document's `children` part. Each entry is a name and the child's URL. That's all core stores about a child.

A name identifies the placement, not the document, so the same document can appear under two names. Any name works. `place` makes a short random one when you don't give one. Use a meaningful name when there is one: a card's example is at `children/example`, and what an embed shows is at `children/of`.

`children` is the only part that makes nodes. A document URL in `value` is a reference to data, not a child.

Core says nothing about where a package keeps what it knows about a child. `shapes` keeps a shape's position in the shape's own value, and gives things that have no position an embed. See [Shapes and embeds](#shapes-and-embeds).

### Paths and identity

A path is the names from the root to a node, as a string with `/` between them:

```
/                 the root
/k3f9             a sheep on the root canvas, named k3f9
/m2p7             an embed on the root canvas
/m2p7/of          the map inside it
/m2p7/of/x1y2     a shape on that map
```

`nodeIn(scope, path)` gives you the node at a path. The pointer reports the node under it as a path. Presence keys its data by path. The inspector shows paths.

Paths are the same in every tab, because every tab reads the same documents.

### Moving a node

When you drag a node from one container to another, its name travels with it:

1. The select tool lifts the node. It removes the name from the old parent's `children` and puts the same name, with the same URL, into the pointer's `children`.
2. On release, the container that takes the drop stores the same name in its own `children`.

The node's path changes, but its name doesn't. A node keeps its puts, its handlers, its element, and its cards for as long as its name exists somewhere in the tree. So a move doesn't rebuild anything. A map keeps its tiles. A tool keeps its selection.

A node's children ride along. When the embed `m2p7` moves from the canvas into the pointer, the map at `of` under it is still the same node: its parent is the same node and its name is unchanged. So the rule for continuity is:

> A node is the same node as before if its name moved, or if its parent is the same node as before and its name is unchanged.

If a move changes which cards reach the node, only those cards attach or detach. The rest stay.

When a name disappears, the node is kept for a short time (500 ms) in case the name shows up in another container. This covers a move by someone else, which arrives as two document changes.

If the same name is live in two places at once, because a document that contains it is placed twice, the first occurrence in tree order keeps its state. Each later occurrence is a separate node that starts fresh.

### Cycles

A document can end up inside itself. For example, you drop an embed of canvas A onto a map that sits on canvas A. The tree would then go on forever: A, embed, map, embed, A, and so on.

The rule: when the walk reaches a document that's already on the path above, it stops there. The node exists and is drawn, but it has no children. It works like a shortcut to a parent folder: you see it, but it doesn't open inside itself.

### References

`value` can refer to nodes or documents. There are two kinds:

| You want to refer to…        | Store…         | Example                                         |
| ---------------------------- | -------------- | ----------------------------------------------- |
| Data, wherever it's placed   | A document URL | A deck's `selected` card                        |
| A particular thing on screen | A node path    | The inspector's `target`, a pointer's `holding` |

When you read state, a document URL becomes a detached node, and a node path becomes the node at that path. Both are `Node` objects. A detached node has no `path` and no `parent`.

References don't affect the tree. A node has one parent, no matter how many fields point at it.

### What exists

A node exists if the root reaches it through `children`. Nothing else makes it exist. Cards are dealt to the nodes that exist. When a node leaves the tree, its cards detach, its puts go, and its element is removed, after the grace period above.

## State

### Stored values and puts

Every node answers `State`:

```ts
type State<T> = {
  read(): Doc<T>; // the document with this node's puts applied
  change(fn: (doc: Doc<T>) => void): void; // write the document
  put(path: string, value: unknown): void; // a temporary value at a "/"-separated path
  put(values: Record<string, unknown>): void;
  overlays(): Record<string, Overlay>; // every path with a put
  clone(): Node; // a new document with the same stored data; detached
  persisted: boolean; // false for a computed node
};
```

`read()` returns the stored document with puts layered on top. A later put wins at its path. A put goes away when the card that made it detaches, or when you put `undefined`.

A put's path starts with the part it's in:

```ts
put("value/selected", true); // a temporary value
put("value/x", 10); // a temporary position
put("children/k3f9", beret.url); // a temporary child
put(`tags/${berets.beret}`, true); // a temporary tag
```

`change` writes the document. The change is attributed to the card that made it.

### Puts belong to a node

Puts are keyed by node, not by document. When you put `value/selected` on a tool, only that placement of the tool is selected. When a map is embedded twice, a sheep on it is two nodes, and a put on one leaves the other alone.

Presence shares the puts on your pointer with other tabs, keyed by path. See [Presence](#presence).

### Computed nodes

Some things follow from other data and don't need a document. A beret follows the shape that wears it. A card's tag token follows the card's descriptor.

`NewComputedNode` makes a document that lives in memory in one tab:

```ts
const beret = request(NewComputedNode, {
  tags: { [shapes.shape]: true, [tags.hat]: true },
});
```

It returns a detached node with `persisted: false`. You place it with a put on a container's `children`, never by storing it. Every tab computes its own.

Code that needs to treat computed nodes differently checks `persisted`:

- Presence doesn't send a put that holds a computed node.
- The select tool lifts a copy of a computed node instead of the node itself. `clone()` makes the copy a real document.

### Placing, unplacing, and moving

Three functions in `@cards/core` are the only code that writes `children`:

```ts
// stores a child; returns its name. No name given: a short random one
place(container: Node, doc: Node, name?: string): string;

// removes a child
unplace(container: Node, name: string): void;

// moves a child from one container to another, keeping its name
move(from: Node, name: string, to: Node): void;
```

`place` throws `already-there` if the name is taken. `unplace` and `move` throw `nothing-there` if it isn't. `move` writes the destination first, then the source.

A container calls `place` from its `Drop` handler. The select tool calls `move` to lift a node into the pointer. A behavior that shows a computed node uses `put` on `children/<name>` instead, since a put isn't a write.

## Symbols

A symbol is a string owned by a package:

```ts
const url = packageUrl(import.meta.url);
const line = symbol(url, "line"); // "automerge:…#line"
```

A package owns the symbols that carry its URL. Two packages can both define `line` without colliding. The URL has no heads, so every version of a package has the same symbols.

Source code never spells a symbol out. It imports it from the package that owns it:

```ts
import { tags as shapes, Drop } from "@cards/shapes";
```

A symbol is used in two ways. As a **tag**, it's stored on a document and says what the document is. As a **message**, it's sent to a node and asks it to do something. The same symbol can be both: a package could define `toggle` as a tag for things that toggle and as the message that toggles them. Nothing does this today.

### Tags

Tags are the `tags` part of a document: `tags/<tag>: true`. `hasTag(node, tag)` reads it. A node's tags decide which cards the dealer deals to it.

A card gives a node another tag with a put on `tags/<tag>`, and the dealer deals that tag's cards to the node. When the put goes, the second card detaches on its own.

Two tags are bare, because no package owns them: `card` and `user`.

### Messages

A message is a symbol with a request and a response type:

```ts
const Toggle = message<void, void>(symbol(url, "toggle"));
```

`node.on(message, handler)` registers a handler. `node.request(message, request)` sends one. Handlers on the node run newest first. If none answers, the message bubbles up to the parent, and so on to the root. A detached node sends straight to the root.

A handler gets the request, a `next` function to pass it on, and the node that sent it:

```ts
on(Drop, ({ node, client, scale }, next, from) => {
  if (!hasTag(node, tags.shape)) return next();
  …
});
```

Handlers live as long as the card that registered them.

The host answers these messages at the root:

| Message           | Answered by | Returns                                   |
| ----------------- | ----------- | ----------------------------------------- |
| `State`           | the backend | the node's state                          |
| `NewNode`         | the backend | a detached node for a new document        |
| `NewComputedNode` | the backend | a detached node for an in-memory document |
| `Lookup`          | the backend | the nearest node with a tag, up the path  |
| `Describe`        | the dealer  | the descriptor of the card that asks      |
| `MyPointer`       | presence    | the pointer of the user at this keyboard  |
| `Pointers`        | presence    | every pointer on this canvas, yours first |

`Lookup` checks each ancestor and that ancestor's direct children. With `orCreate`, a missing node is created and placed under the root.

## Cards

### Packages

A package is a folder, published as one Automerge document with pushwork. Its entry module exports the package's types, symbols, and card descriptors. The [loader spec](loader-spec.md) covers publishing and loading.

Packages share contracts through imports and share behavior only through messages. Nothing a package can import reads or writes a document, except `place`, `unplace`, and `move`, which write only `children`.

### Card descriptors

A card descriptor describes one card:

```ts
card({
  id: "pen",
  title: "Pen",
  description: "A tool that draws lines onto whatever surface you press.",
  matches: tags.pen, // the tag it's dealt to
  accepts: [PointerDown, PointerMove, PointerUp], // every message it handles, on any node
  behavior: () => import("./pen.js"),
  example: (node) => node.request(NewNode, { … }), // an instance to show on the card
});
```

A card document is tagged `card` and names its descriptor in `value.card`, as `symbol(package, id)`. The title, description, and tag come from the descriptor at run time, so the document stays small.

The card's example is its child at `children/example`. Its tag token is a put child at `children/token`. The card draws both in its preview. Both are templates: dragging one out lifts a copy.

### Where a card reaches

A card is dealt downwards. It reaches the nearest ancestor that doesn't deal through, and everything under that ancestor.

A node deals through by putting `value/dealsThrough: true`. A deck does, so the cards in it reach the deck's container. An embed does, so a deck on an embedded map reaches the canvas the embed sits on. A pointer does, so a card in your hand reaches everything, until it's dropped.

| The card is…                   | It reaches…                             |
| ------------------------------ | --------------------------------------- |
| in the deck on the root canvas | everything                              |
| in a deck on an embedded map   | the canvas the embed sits on, and below |
| lying on an embedded canvas    | that canvas and everything on it        |
| in someone's hand              | everything, until it's dropped          |

Within its reach, a card matches every node that carries its `matches` tag.

### Attaching

The dealer keys each attachment by the node, the card, and the descriptor's version. It attaches when a key appears and detaches when it goes. Because a moved node keeps its key, a move doesn't touch its attachments unless its reach changes.

A new version of a package means new descriptors. The dealer detaches every attachment made from the old version and attaches again with the new code.

### Accepted messages

A behavior can only register handlers for the messages its descriptor accepts. `Node.on` throws otherwise, and the dealer reports the card as failed. Sending isn't restricted.

The declaration covers handlers on any node. The pen handles `PointerDown` on the pointer, so it declares `PointerDown`.

## Rendering

`@cards/core/render` exports `View` and `Child`. `View` shows a node's view. It builds the element once per node and moves it to wherever the node is shown, so a node that moves between containers keeps its elements, transitions, and focus.

A card draws a node by putting `value/view`:

```tsx
request(State).put("value/view", () => <CanvasView … />);
```

A node that no card draws shows as a box with a question mark.

`Child` wraps `View` with the `data-node` attribute set to the node's path. That's how the pointer finds what's under it.

## Presence

Presence shares the puts on your pointer with everyone who has the canvas open, as ephemeral messages on the root document. Each message lists the puts by node path. Other users' puts arrive as ordinary puts on the nodes at those paths.

Presence drops two kinds of values before sending: functions, such as views, and computed nodes. Every tab computes its own.

Presence also puts each present user's pointer into the root's `children`, and answers `MyPointer` and `Pointers`. A pointer's name is derived from the user's document URL, so its path is the same in every tab.

## Packages in this repository

Everything in this section is userspace. A different set of packages could put different things on the same core.

### `shapes`

Owns positions, embeds, and the container protocol.

#### Shapes and embeds

A **shape** carries its own position:

```ts
type Shape = {
  x: number; // in the surface's terms: pixels on a canvas, longitude on a map
  y: number;
  scale?: number;
  order?: number; // stacking, lowest first
  glide?: number; // milliseconds a change of position animates over
};
```

A surface reads the position from the shape and draws it there. A surface writes a shape's position in `Drop` and `Move`, and nothing else in the shape's document.

Because the position is in the shape's document, a shape is one thing in one place. Place a sheep twice and both copies sit at the same spot. To show the same thing twice, embed it.

An **embed** is a shape that shows something with no position of its own: a map, a canvas, a deck, a card. It has a size and one child, named `of`:

```ts
type Embed = Shape & {
  width: number;
  height: number;
};
```

```
canvas
  ├─ k3f9  sheep   value: { x: 10, y: 20 }
  └─ m2p7  embed   value: { x: 50, y: 0, width: 400, height: 300 }
             └─ of  map     value: { camera: … }
```

The embed card draws its `of` child clipped to its size. The map inside knows nothing about where it is. Two embeds of the same map have two sizes, two positions, and two nodes at `of`, each with its own puts.

Things that aren't shapes, like decks, cards, and tools, don't carry a position. A canvas that takes one wraps it in an embed. A deck that takes one takes it bare.

#### The container protocol

A container says what it takes with `takes`, one put per tag:

```ts
request(State).put(`value/takes/${shapes.shape}`, true);
```

The select tool walks up from the node under the pointer to the nearest node that takes the held node. A held embed counts as both itself and its `of`. The container gets the `Drop` with the one it takes:

```ts
type DropRequest = {
  node: Node; // the node being dropped
  client: Point; // where its origin goes, in screen pixels
  scale: number; // its scale on screen
  pointer?: Point; // where the pointer is, if not at the origin
};
const Drop = message<DropRequest, string | undefined>(symbol(url, "drop"));
```

A surface converts the screen point into its own terms, writes the position into the shape, calls `place`, and answers with the name. A `Drop` that nobody answers bubbles up to the root canvas, which takes anything: a shape as it is, anything else in a new embed.

Several cards can take drops on one node. A map takes shapes, and the shape card on the map takes tag tokens. Each handler calls `next()` for anything that isn't its kind.

`Move` asks a surface to move a shape by the shape's own pixels. The canvas adds them. The map projects them:

```ts
const Move = message<{ node: Node; by: Point }, string | undefined>(
  symbol(url, "move"),
);
```

#### Stacking

Shapes stack by `order`, lowest first. `ordered(node)` returns a surface's children sorted by `order`, then by name, so every tab stacks ties the same way. `orderAt(shapes, index)` returns the order that puts a shape at an index, between its neighbors.

A drop lands on top of a canvas or a map.

#### The canvas

A surface in plain pixels. It draws the children tagged `shape`, in order, and pointers above all of them. Other children exist in the tree and get cards, but aren't drawn. This keeps a tool's selection object off the canvas.

The root is a canvas. A canvas anywhere else is embedded.

### `tools`

Owns the pointer, the tools, the card view, and the `template` and `token` tags.

#### Pointers

Each user's pointer is a node under the root. The pointer card turns presses on the canvas into pointer events that say which node is under the pointer, as a path.

While you drag something, it's a child of your pointer. The pointer isn't a surface: it draws its children under the cursor, ignoring their position, so a dragged shape brings its beret along. `holding` in the pointer's `value` is a path reference to the same node, for cards that want to know what's held without walking the pointer's children. The pointer deals through.

#### The select tool

The select tool owns the drag gesture:

1. **Press.** Remember the node under the pointer and where it was grabbed. Don't claim the press yet, so a click still reaches what you clicked.
2. **Lift.** After four pixels, claim the press. If the node is the `of` of an embed, lift the embed instead, so grabbing a map's background lifts the map. If the node is a template or isn't persisted, clone it and `place` the clone into the pointer. Otherwise `move` it into the pointer. The root can't be lifted.
3. **Move.** Walk up from the node under the pointer to the nearest node that takes the held node, or its `of` if it's an embed. Put it as `value/grip/over`.
4. **Release.** Send `Drop` to `grip.over` with the node it takes, or to the root. When a container takes the `of` out of an embed, the embed is left behind in the pointer and unplaced.

### `deck`

Holds cards. It draws the children tagged `card` as a list, and shows the selected one. A drop lands at the slot under the pointer. The deck deals through.

A deck isn't a shape. A deck on a canvas is embedded.

### `map`

A surface in longitude and latitude. The camera is in the map's document. Dragging the background pans, but only while the select tool is selected.

A map isn't a shape. A map on a canvas is embedded, and the embed gives it its size.

### `beret` and `france`

The beret card is dealt to anything tagged `beret`. It makes a computed hat, keeps the hat's position just above the target's, and puts the hat into the target's parent:

```ts
export default ((target) => {
  const { request } = target;
  const beret = request(NewComputedNode, {
    tags: { [shapes.shape]: true, [tags.hat]: true },
  });
  const name = newName();

  createEffect(() => {
    const {
      x,
      y,
      scale,
      order = 0,
      glide,
    } = request(State).read<Shape>().value;
    beret.request(State).put({
      "value/x": x,
      "value/y": y,
      "value/scale": scale,
      "value/order": order + 0.5,
      "value/glide": glide,
    });
  });

  createEffect(() => {
    const container = target.parent;
    if (!container) return;
    container.request(State).put(`children/${name}`, beret.url);
    onCleanup(() =>
      container.request(State).put(`children/${name}`, undefined),
    );
  });
}) satisfies Behavior;
```

The hat card draws anything tagged `hat`. `beret` and `hat` are different tags: `beret` means "wears one" and `hat` means "is one", so a beret doesn't get a beret.

If you drag the beret, the select tool sees `persisted: false` and lifts a copy. The copy is a real document tagged `hat`. The shape keeps its beret.

The French card is dealt to anything tagged `french`. While the node sits on a map and its position is inside France, the card puts the `beret` tag on it:

```ts
createEffect(() =>
  request(State).put(`tags/${berets.beret}`, inFrance() || undefined),
);
```

The put is per node. If the map is embedded twice, each embed's sheep decides for itself.

## Host

### `@cards/core`

- `Node`, with `url`, `path`, `name`, `parent`, `on`, `request`, and `attach`.
- `nodeIn(scope, path)` and `docIn(scope, url)`.
- `Doc`; `place`, `unplace`, and `move`.
- `State`, `NewNode`, `NewComputedNode`, `Lookup`, `Describe`, `MyPointer`, and `Pointers`.
- `childNodes(node)`, `walk(root)`, `rootOf(node)`, and `hasTag(node, tag)`.
- `symbol`, `message`, `card`, and `packageUrl`. `tag` stays as an alias of `symbol` until the packages move over.
- `@cards/core/render`, with `View` and `Child`.

The backend keeps documents by URL and everything else (puts, handlers, elements) by node. It walks the tree from the root, makes a node for each name in `children`, cuts cycles, carries a node's state when its name moves or its parent moves, and applies the grace period when a name disappears.

### `site/src/dealer.ts`

Walks the tree, finds every card, works out each card's reach from `dealsThrough`, and attaches descriptors to the nodes they match. Watches each card's package through the loader and re-attaches on a new version.

### `site/src/presence.ts`

Shares pointer puts by path. Places each present user's pointer under the root.

### `site/src/main.tsx`

Opens the repo and the loader. Opens the space in the URL hash, or seeds a new one: a root canvas, the select tool, the pen, the inspector, an embedded deck with every card from every package, and an embedded map. This is the one place in the host that names tags from packages.

## Work plan

Each step runs on its own. Packages are pushed after each step.

1. **Parts.** Documents become `{ value, children, tags }`. `children` is a record of URLs by name. `shapes` adds the embed; the deck and the map stop being shapes and are embedded. `place`, `unplace`, and `move` are the only writers of `children`. Node identity stays by URL for now.
2. **Paths.** A node is its path. The pointer, presence, and the inspector use paths. Two placements of one document become two nodes.
3. **Per-node state.** Puts, handlers, elements, and attachments are keyed by node. A moved node and its descendants keep them. The grace period replaces the dealer's linger.
4. **Reach.** The dealer deals downwards, through nodes that deal through.

## Compatibility

Spaces created before this change aren't supported. Open the page without a URL hash to seed a new one.

## Open questions

**Pinned dependencies.** The page runs every package at its latest version, while `tsc` checks against the version in the lockfile. A package can run against a newer contract than it was checked against.

**Typed tags.** `tags` is `Record<string, string>`. A literal type per tag would let the compiler reject unknown tags.

**Generic `Node`.** Whether to make `Node` generic in its accepted messages, so that handling an undeclared message is a type error rather than a runtime one.

# Messages and behaviors

Principles for writing cards, taken from the refactors that removed the container helpers and the dom library. Paths point at examples in `cards-packages`. They are illustrations, not the shape every environment has to take: a space could be a canvas of shapes, a text editor, or something with no spatial layout at all.

A **behavior** is the code the dealer attaches to every node with a card's tag. A **message** is a typed name that behaviors send and handle. A package exports **contracts** (types, tags, messages) and card descriptors.

## Sharing

**Share contracts, not functions.** A package may export types, tags, messages and descriptors. It may not export a function that reads or writes a document or walks the tree: two packages pinned at different versions would run two versions of the same protocol. A pure helper with no document state, like `View` and `Child` in `@cards/core/render`, belongs in the environment, alongside `solid-js`.

**Local helpers are fine.** A function that only one card uses stays in that card's file, even if it walks the tree. `surfaceOf` in `lines/src/pen.tsx` and `dropTarget` in `tools/src/select.tsx` are examples. If a second card needs the same function, look at who owns the data (next section) before you move the function into a shared package.

## Ownership

**The owner of the data handles the change.** Don't write a shared function that edits someone else's document. Send a message to the node that owns the document and let it change its own data. Every container handles `Drop` by adding to its own `children`, so nobody else needs to know how it stores them (`shapes/src/canvas.tsx`, `deck/src/deck.tsx`, `map/src/map.tsx`).

**A message is for behavior that differs between receivers.** `Drop` is a message because a canvas, a deck and a map each turn a screen point into their own terms. Moving a node into `children` would be the same code everywhere, so it was never a message. The `Place`, `Remove` and `Taker` messages collapsed into one `Drop`, and a lot of messages is usually a sign that this went wrong.

**Prefer data to a question.** If every receiver would answer a message the same way, the answer is a field. A container declares what it accepts with a `takes` field instead of answering a `Taker` message, and `children` is plain data that any walk can read.

**One place for each change.** A node is added to a container only by that container's `Drop` handler. It leaves a container only when the tool that moves it lifts it (`takeOut` in `tools/src/select.tsx`). When two cards could do the same edit, pick one owner.

## The environment boundary

**One card reads the outside world, and translates it.** Something has to turn raw input (DOM events, key presses, selections) into nodes. Keep that in one card, and have it speak the node vocabulary: URLs, points, plain data. Here that card is the pointer (`tools/src/pointer.tsx`): it is the only code that looks at the page as a whole, and it reports the URL of the node under the cursor. A text editor would have the same kind of card for keyboard input and selection.

**Everyone else measures only what they render.** A card reads its own elements through refs, never by querying the page. The deck finds a row through its own `rows` ref, and the map converts a point through its own frame.

**Convert at the receiver.** Send coordinates in a frame both sides share, such as client pixels, and let the receiver convert them into its own terms. Only the receiver knows its own transform: a map's projection, a zoomed viewport, a text offset.

**Pass URLs, bind them in your own scope.** Don't send elements or nodes from another process through a message. Send a URL and bind it with `nodeIn(scope, url)`. Reads hydrate any URL into a node in the reader's scope, at any depth, so a URL you put comes back as a node.

## Coordination

**Infrastructure knows nothing about its consumers.** The pointer knows nothing about tools, and a container knows nothing about who drops into it. Arbitration uses generic rules:

- Handlers run newest first. Each one either calls `next()` or answers.
- A handler claims a press by returning its URL (`PointerDown` and `PointerMove` in `tools/src/index.ts`).
- A card that wants every press puts a standing claim on the pointer (`claimedBy`, used by `tools/src/inspector.tsx`).
- A view that keeps an event uses the platform's own convention. The map calls `preventDefault`.

**Claim late.** Take ownership only once the input is unambiguously yours. The select tool and the pen claim on the first real move, so a click still reaches the button under it. This removed the `isControl` heuristic: nobody had to guess what counts as a control.

**Depend on a tag directly rather than add a generic message.** If one card needs to know about another, look the other card up by its tag. The map finds the select tool with `Lookup` and pans only while it's selected. That replaced a `Pan` message that only the map ever handled.

**Declare what you handle; send freely.** A descriptor's `accepts` lists every message its behavior registers a handler for, on any node. Sending isn't restricted.

## Shared and local state

**Shared state is plain data in puts.** Presence syncs a user's puts to every tab, so another tab sees what a pointer holds and where it hovers (`holding`, `grip`, `position`). Keep these in shared terms that mean the same thing in every tab.

**Screen-specific state is a function in a put.** A function value never syncs, so each tab computes it for itself. The pointer's `client()` and every card's `view` work this way. When a value depends on this screen, put a function instead of a number.

**Discover through the protocol, not the filesystem.** Packages are documents referenced by URL, and a checkout may not have them on disk. Find cards through descriptors, tags and `Lookup`, never by looking for folders.

## Before adding something

If a design needs a special case, such as a marker attribute, a flag on an event, or a helper for one caller, first look for a version where it isn't needed. `data-pan`, `data-inert`, `isControl` and the whole dom library went away once each piece of data had a clear owner and claims became generic.

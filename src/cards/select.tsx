import type { AutomergeUrl } from "@automerge/automerge-repo";
import { batch, createEffect, createMemo } from "solid-js";
import {
  hasTag,
  Lookup,
  message,
  rootOf,
  state,
  State,
  type Behavior,
  type Node,
  type Point,
} from "core";
import { elementAt, elementOf, hit } from "dom";
import type {
  Canvas,
  DropRequest,
  PanRequest,
  Shape,
  TakeRequest,
  Taken,
} from "./canvas";
import type { PointerInput } from "./pointer";
import type { Tool } from "./tool";

const PointerDown = message<PointerInput, AutomergeUrl | undefined>(
  "pointer/down",
);
const PointerMove = message<PointerInput, void>("pointer/move");
const PointerUp = message<PointerInput, void>("pointer/up");
const Toggle = message<void, void>("tool/toggle");
const Take = message<TakeRequest, Taken | undefined>("container/take");
const Drop = message<DropRequest, AutomergeUrl | undefined>("container/drop");
const Pan = message<PanRequest, void>("container/pan");

const THRESHOLD = 4; // pixels before a press becomes a drag, so plain clicks still reach the shape's own UI

// what's being pressed (puts); `target` is where the dragged node is now, which changes when it's lifted
type Press = {
  target: Node;
  pan: boolean; // pressed on a surface's background: pans instead of moving
  start: Point;
  last: Point;
  grab: Point; // where the target was grabbed, in its own pixels
  scale: number; // the target's size on screen
  dragging?: boolean; // past the threshold
  over?: { from: Node; url: AutomergeUrl }; // the container that would take it, and the node it was reached from
};
type Select = Shape & Tool & { press?: Press };

// The default tool: drag anything to move it between containers, drag a surface's background to pan it.
export default (({ url, parent, request }) => {
  request(State).put("@tags/tool", true);
  const self = () => request(State).read<Select>();
  const selected = () => self().selected ?? false;
  const root = () => rootOf(parent!);
  const pointer = createMemo(() => request(Lookup, { tag: "pointer" }));

  createEffect(() => {
    const p = pointer();
    if (!p) return;
    p.on(PointerDown, (e, next) => {
      if (e.claimedBy || !selected()) return next();
      press(e);
      return url;
    });
    p.on(PointerMove, (e, next) => (e.claimedBy === url ? move(e) : next()));
    p.on(PointerUp, (e, next) => (e.claimedBy === url ? release(e) : next()));
  });

  request(State).put("view", () => (
    <button
      class="btn"
      classList={{ active: selected() }}
      onClick={() => request(Toggle)}
    >
      ↖ Select
    </button>
  ));

  function press(e: PointerInput) {
    const target = hit(root(), e.element, { previews: true });
    const el = elementOf(target.url, e.element);
    const rect = el?.getBoundingClientRect();
    const scale = el && el.offsetWidth ? rect!.width / el.offsetWidth : 1;
    const grab = rect
      ? {
          x: (e.client.x - rect.left) / scale,
          y: (e.client.y - rect.top) / scale,
        }
      : { x: 0, y: 0 };
    const pan = Boolean(
      e.element.closest("[data-pan], [data-node]")?.hasAttribute("data-pan"),
    );
    request(State).put("press", {
      target,
      pan,
      start: e.client,
      last: e.client,
      grab,
      scale,
    } satisfies Press);
  }

  function move(e: PointerInput) {
    const p = self().press;
    if (!p) return;
    if (p.pan) {
      p.target.request(Pan, {
        delta: { x: e.client.x - p.last.x, y: e.client.y - p.last.y },
      });
      request(State).put("press", { ...p, last: e.client });
      return;
    }
    if (
      !p.dragging &&
      (distance(p.start, e.client) < THRESHOLD || p.target.url === root().url)
    )
      return;
    // one step for the dealer: a card that changes containers mustn't look gone in between
    batch(() => drag(p, e.client));
  }

  // asks what's under the pointer who would take the target, and lets that container show it. The target stays
  // where it is while its own container would keep it, unless that is a surface; otherwise it's lifted onto the
  // root, so it can follow the pointer anywhere
  function drag(p: Press, client: Point) {
    const under = hit(root(), elementAt(client, p.target.url) ?? null);
    const send = (from: Node, phase: DropRequest["phase"]) =>
      from.request(Drop, {
        node: p.target,
        client: originAt(client, p),
        pointer: client,
        scale: p.scale,
        phase,
      });
    let accepted = send(under, "over");
    if (p.over && p.over.url !== accepted) {
      send(p.over.from, "out");
      accepted = send(under, "over"); // "out" passes by every container up the way, including this one
    }

    let { target, scale } = p;
    const parent = target.parent!;
    const kept = accepted === parent.url && !hasTag(parent, "surface");
    if (parent.url !== root().url && !kept) {
      const taken = target.request(Take, { node: target });
      if (!taken) return;
      scale = taken.scale ?? scale;
      root().request(Drop, {
        node: taken.node,
        client: originAt(client, { grab: p.grab, scale }),
        scale,
      });
      target = state<Canvas>(root()).children.find(
        (c) => c.url === taken.node.url,
      )!;
    }
    if (target.parent?.url === root().url) {
      const origin = originAt(client, { grab: p.grab, scale });
      const surface = elementOf(root().url)!.getBoundingClientRect();
      const dragging = accepted && accepted !== root().url ? "over" : true;
      target.request(State).put({
        x: origin.x - surface.left,
        y: origin.y - surface.top,
        dragging,
      });
    }
    const over = accepted ? { from: under, url: accepted } : undefined;
    request(State).put("press", {
      ...p,
      target,
      scale,
      dragging: true,
      last: client,
      over,
    } satisfies Press);
  }

  // ends the drag over whatever is under the pointer; the first container up from there that accepts gets it
  function release(e: PointerInput) {
    const p = self().press;
    request(State).put("press", undefined);
    if (!p?.dragging) return;
    const target = p.target;
    const under = hit(root(), elementAt(e.client, target.url) ?? null);
    const send = (from: Node, phase: DropRequest["phase"]) =>
      from.request(Drop, {
        node: target,
        client: originAt(e.client, p),
        pointer: e.client,
        scale: p.scale,
        phase,
      });
    batch(() => {
      if (p.over) send(p.over.from, "out");
      target
        .request(State)
        .put({ x: undefined, y: undefined, dragging: undefined });
      const accepted = send(under, "drop");
      if (accepted && accepted !== target.parent?.url)
        target.request(Take, { node: target });
    });
    swallowClick();
  }
}) satisfies Behavior;

// where the dragged node's top-left goes when the pointer is at `client`
function originAt(client: Point, p: Pick<Press, "grab" | "scale">): Point {
  return { x: client.x - p.grab.x * p.scale, y: client.y - p.grab.y * p.scale };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// a drag ends with a click on whatever was pressed; it shouldn't also press that button
function swallowClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(
    () => window.removeEventListener("click", stop, { capture: true }),
    100,
  );
}

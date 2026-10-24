import type { AutomergeUrl } from "@automerge/automerge-repo";
import { batch, createEffect, createMemo } from "solid-js";
import {
  hasTag,
  message,
  rootOf,
  state,
  State,
  type Behavior,
  type Node,
} from "core";
import { myPointer, removeFrom, taker } from "container";
import { elementAt, elementOf, hit } from "dom";
import type { DropRequest, PanRequest, Point, Shape } from "./canvas";
import type { Grip, Pointer, PointerInput } from "./pointer";
import type { Tool } from "./tool";

const PointerDown = message<PointerInput, AutomergeUrl | undefined>(
  "pointer/down",
);
const PointerMove = message<PointerInput, void>("pointer/move");
const PointerUp = message<PointerInput, void>("pointer/up");
const Toggle = message<void, void>("tool/toggle");
const Drop = message<DropRequest, AutomergeUrl | undefined>("container/drop");
const Pan = message<PanRequest, void>("container/pan");

const THRESHOLD = 4; // pixels before a press becomes a drag, so plain clicks still reach the shape's own UI

// what's being pressed (puts); once lifted, the pointer holds it
type Press = {
  pressed: Node;
  pan: boolean; // pressed on a surface's background: pans instead of moving
  start: Point;
  last: Point;
  grab: Point; // where `pressed` was grabbed, in its own pixels
  scale: number; // its size on screen, once lifted: the size it's held at
  lifted?: boolean; // past the threshold: taken from its container, in the pointer's hand
};
type Select = Shape & Tool & { press?: Press };

// The default tool: drag anything to move it between containers, drag a surface's background to pan it.
// A template (a card's example) is dragged as itself and dropped as a copy.
export default (({ url, parent, request }) => {
  request(State).put("@tags/tool", true);
  const self = () => request(State).read<Select>();
  const selected = () => self().selected ?? false;
  const root = () => rootOf(parent!);
  const pointer = createMemo(() => myPointer(parent!));
  const hand = () => pointer()!.request(State);

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
    const pressed = hit(root(), e.element, { previews: true });
    const el = elementOf(pressed.url, e.element);
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
      pressed,
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
      p.pressed.request(Pan, {
        delta: { x: e.client.x - p.last.x, y: e.client.y - p.last.y },
      });
      request(State).put("press", { ...p, last: e.client });
      return;
    }
    if (!p.lifted) {
      if (distance(p.start, e.client) < THRESHOLD) return;
      if (p.pressed.url === root().url) return;
      lift(p);
    }
    follow(self().press!, e.client);
  }

  // takes the pressed node out of its container and puts it in the pointer's hand; a template stays where it
  // is and is held as itself, at full size
  function lift(p: Press) {
    const template = hasTag(p.pressed, "template");
    const lifted: Press = {
      ...p,
      lifted: true,
      scale: template ? 1 : p.scale,
    };
    batch(() => {
      if (!template) removeFrom(p.pressed.parent!.request(State), p.pressed);
      hand().put({ holding: p.pressed.url, grip: grip(lifted) });
      request(State).put("press", lifted);
    });
  }

  // tells the pointer which container would take what it holds, so that container and the held node can show it
  function follow(p: Press, client: Point) {
    const under = hit(root(), elementAt(client, p.pressed.url) ?? null);
    hand().put("grip", grip(p, taker(under, p.pressed)));
  }

  // hands what the pointer holds to the container under it; the root canvas takes anything, so it always lands
  function release(e: PointerInput) {
    const p = self().press;
    request(State).put("press", undefined);
    if (!p?.lifted) return;
    const over = state<Pointer>(pointer()!).grip?.over ?? root();
    const node = hasTag(p.pressed, "template")
      ? p.pressed.request(State).clone()
      : p.pressed;
    batch(() => {
      hand().put({ holding: undefined, grip: undefined });
      over.request(Drop, {
        node,
        client: originAt(e.client, p),
        pointer: e.client,
        scale: p.scale,
      });
    });
    swallowClick();
  }
}) satisfies Behavior;

// a grip as it is put: the container is stored by url and read back as a node
function grip(p: Press, over?: Node): Record<keyof Grip, unknown> {
  return { grab: p.grab, scale: p.scale, over: over?.url };
}

// where the held node's top-left goes when the pointer is at `client`
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

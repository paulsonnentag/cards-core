import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import {
  message,
  rootOf,
  State,
  type Behavior,
  type Node,
  type Tagged,
} from "core";
import { Child, myPointer } from "container";
import type { Point, Shape } from "./canvas";

// a user has one pointer; the root knows the user at this keyboard as `me`, and presence lists the others
export type User = Tagged & { pointer: Node };
export type Pointer = Shape & {
  // puts
  position?: Point;
  claimedBy?: Node;
  holding?: Node; // what the pointer carries while a tool drags it; rendered here, under the cursor
  grip?: Grip;
};
export type Grip = {
  grab: Point; // where the held node was grabbed, in its own pixels
  scale: number; // its size on screen
  over?: Node; // the container that would take it
};
// `element` is what was pressed; resolve it with `hit` from your own root so the node is bound to your process
export type PointerInput = {
  client: Point;
  element: Element;
  claimedBy?: AutomergeUrl;
};

// Subscribe with pointer.on(...). Handlers run newest first and call next() to pass the event on.
// A PointerDown handler claims the pointer by returning its url instead of calling next(); until release,
// moves and ups carry claimedBy, and everyone else should just call next().
const PointerDown = message<PointerInput, AutomergeUrl | undefined>(
  "pointer/down",
  () => undefined,
);
const PointerMove = message<PointerInput, void>("pointer/move", () => {});
const PointerUp = message<PointerInput, void>("pointer/up", () => {});

// Listens on the whole surface it sits on, so presses on shapes reach subscribers too. After a press it follows
// the window rather than capturing the pointer, so buttons still get their clicks. Other users' pointers only
// show where they are and what they hold.
export default (({ url, parent, request }) => {
  const self = () => request(State).read<Pointer>();
  // a memo, so the view only re-listens when this really changes, not on every put at the root
  const mine = createMemo(() => myPointer(parent!)?.url === url);
  let pressed = false;
  // held above a container that would take it, other than the canvas itself
  const over = () => {
    const target = self().grip?.over;
    return Boolean(target && target.url !== rootOf(parent!).url);
  };

  request(State).put("view", () => (
    <PointerView self={self()} mine={mine()} over={over()} listen={listen} />
  ));

  function listen(surface: HTMLElement) {
    const emit = (
      msg: typeof PointerDown | typeof PointerMove | typeof PointerUp,
      e: PointerEvent,
    ): any => {
      const rect = surface.getBoundingClientRect();
      const client: Point = { x: e.clientX, y: e.clientY };
      request(State).put("position", {
        x: client.x - rect.left,
        y: client.y - rect.top,
      });
      return request(msg as any, {
        client,
        element: e.target as Element,
        claimedBy: self().claimedBy?.url,
      });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pressed = true;
      request(State).put("claimedBy", emit(PointerDown, e));
    };
    const move = (e: PointerEvent) => emit(PointerMove, e);
    const up = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      emit(PointerUp, e);
      request(State).put("claimedBy", undefined);
    };

    surface.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    onCleanup(() => {
      surface.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    });
  }
}) satisfies Behavior;

const PointerView: Component<{
  self: Pointer;
  mine: boolean;
  over: boolean;
  listen(surface: HTMLElement): void;
}> = (props) => {
  let el!: HTMLDivElement;
  createEffect(() => {
    if (props.mine) props.listen(el.closest(".canvas") as HTMLElement);
  });
  // the pointer's own origin on the canvas; what it shows is offset from there
  const at = (p: Point) => ({
    x: p.x - (props.self.x ?? 0),
    y: p.y - (props.self.y ?? 0),
  });

  return (
    <div ref={el}>
      <Show when={props.self.position}>
        {(position) => (
          <>
            <Show when={props.self.holding && props.self.grip}>
              {(grip) => {
                const origin = () => {
                  const p = at(position());
                  const g = grip();
                  return {
                    x: p.x - g.grab.x * g.scale,
                    y: p.y - g.grab.y * g.scale,
                  };
                };
                return (
                  <div class="held" classList={{ over: props.over }}>
                    <Child
                      node={props.self.holding!}
                      style={{
                        left: `${origin().x}px`,
                        top: `${origin().y}px`,
                        transform: `scale(${grip().scale})`,
                      }}
                    />
                  </div>
                );
              }}
            </Show>
            <div
              class="cursor"
              classList={{ remote: !props.mine }}
              style={{
                left: `${at(position()).x}px`,
                top: `${at(position()).y}px`,
              }}
            />
          </>
        )}
      </Show>
    </div>
  );
};

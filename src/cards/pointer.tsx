import type { AutomergeUrl } from "@automerge/automerge-repo";
import { onCleanup, onMount, Show, type Component } from "solid-js";
import { message, State, type Behavior, type Node, type Point } from "core";
import type { Shape } from "./canvas";

export type Pointer = Shape & { position?: Point; claimedBy?: Node }; // puts
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
// the window rather than capturing the pointer, so buttons still get their clicks.
export default (({ request }) => {
  const self = () => request(State).read<Pointer>();

  request(State).put("view", () => (
    <PointerView self={self()} listen={listen} />
  ));

  function listen(surface: HTMLElement) {
    let pressed = false;

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
  listen(surface: HTMLElement): void;
}> = (props) => {
  let el!: HTMLDivElement;
  onMount(() => props.listen(el.closest(".canvas") as HTMLElement));

  return (
    <div ref={el}>
      <Show when={props.self.position}>
        {(p) => (
          <div
            class="cursor"
            style={{
              left: `${p().x - props.self.x}px`,
              top: `${p().y - props.self.y}px`,
            }}
          />
        )}
      </Show>
    </div>
  );
};

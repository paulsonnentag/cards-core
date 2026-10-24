import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Show } from "solid-js";
import { message, State, type Behavior, type Node } from "../core";
import type { Point, Pointer } from "../lib";

export type PointerInput = { surface: Node; position: Point; claimedBy?: AutomergeUrl };

// Subscribe with pointer.on(...). Handlers run newest first and call next() to pass the event on.
// A PointerDown handler claims the pointer by returning its url instead of calling next(); until release,
// moves and ups carry claimedBy, and everyone else should just call next().
export const PointerDown = message<PointerInput, AutomergeUrl | undefined>("pointer/down", () => undefined);
export const PointerMove = message<PointerInput, void>("pointer/move", () => {});
export const PointerUp = message<PointerInput, void>("pointer/up", () => {});

// Sits first in the surface's shapes so it renders underneath everything and only receives
// pointer events where nothing else is hit.
export default (({ parent, request }) => {
  const self = () => request(State).read<Pointer>();

  request(State).put({
    view: () => (
      <>
        <div
          class="pointer-layer"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            down(e);
          }}
          onPointerMove={(e) => emit(PointerMove, e)}
          onPointerUp={(e) => up(e)}
        />
        <Show when={self().position}>
          {(p) => <div class="cursor" style={{ left: `${p().x - self().x}px`, top: `${p().y - self().y}px` }} />}
        </Show>
      </>
    ),
  });

  function down(e: PointerEvent) {
    const claimedBy = emit(PointerDown, e);
    request(State).put("claimedBy", claimedBy);
  }

  function up(e: PointerEvent) {
    emit(PointerUp, e);
    request(State).put("claimedBy", undefined);
  }

  function emit<Res>(msg: typeof PointerDown | typeof PointerMove | typeof PointerUp, e: PointerEvent): Res {
    const position = toSurface(e);
    request(State).put("position", position);
    return request(msg as any, { surface: parent!, position, claimedBy: self().claimedBy?.url });
  }
}) satisfies Behavior;

function toSurface(e: PointerEvent): Point {
  const rect = (e.currentTarget as HTMLElement).closest(".canvas")!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

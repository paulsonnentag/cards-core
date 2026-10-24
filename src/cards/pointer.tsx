import { Show } from "solid-js";
import { State, type Node } from "../core";
import { state, type Point, type Pointer } from "../lib";

// Sits first in the surface's shapes so it renders underneath everything and only receives
// pointer events where nothing else is hit.
export default (node: Node) => {
  node.request(State).overlay({
    view: () => (
      <>
        <rect
          width="100%"
          height="100%"
          fill="transparent"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            update(e, true);
          }}
          onPointerMove={(e) => update(e, e.buttons > 0)}
          onPointerUp={(e) => update(e, false)}
        />
        <Show when={state<Pointer>(node).position}>
          {(p) => <circle cx={p().x} cy={p().y} r={3} fill="red" pointer-events="none" />}
        </Show>
      </>
    ),
  });

  function update(e: PointerEvent, down: boolean) {
    node.request(State).overlay({ position: toSurface(e), down });
  }
};

function toSurface(e: PointerEvent): Point {
  const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

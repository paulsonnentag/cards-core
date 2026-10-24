import type { Component, JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { state, State, type Node } from "./core";
import type { Container, Shape } from "./cards/canvas";

// renders a node inside its container; data-node is how the pointer finds nodes again
export const Child: Component<{ node: Node; style?: JSX.CSSProperties }> = (
  props,
) => (
  <div
    class="child"
    classList={{
      dragging: Boolean(state<Shape>(props.node).dragging),
      over: state<Shape>(props.node).dragging === "over",
    }}
    data-node={props.node.url}
    style={props.style}
  >
    <Dynamic component={state<Shape>(props.node).view} />
  </div>
);

// adds `node` to the container's children (if it isn't there yet) and sets where it sits. With `at`, it ends up
// at that index, counted without it, so a child already there is moved
export function placeIn(
  container: State<Container>,
  node: Node,
  fields: Record<string, unknown>,
  at?: number,
) {
  container.change((d) => {
    if (!d.children) d.children = [];
    const i = d.children.findIndex(
      (c) => (c as unknown as string) === node.url,
    );
    if (at === undefined) {
      if (i < 0) d.children.push(node);
    } else if (i !== at) {
      if (i >= 0) d.children.splice(i, 1);
      d.children.splice(Math.min(at, d.children.length), 0, node);
    }
  });
  if (Object.keys(fields).length === 0) return;
  const child = container.read().children.find((c) => c.url === node.url)!;
  child.request(State).change((d: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(fields)) d[key] = value;
  });
}

// removes `node` from the container's children; false if it wasn't one
export function removeFrom(container: State<Container>, node: Node): boolean {
  const i = (container.read().children ?? []).findIndex(
    (c) => c.url === node.url,
  );
  if (i < 0) return false;
  container.change((d) => {
    d.children.splice(i, 1);
  });
  return true;
}

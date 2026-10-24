import { For, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { State, type Node } from "../core";
import { state, type Canvas, type Shape } from "../lib";

export default (node: Node) => {
  node.request(State).overlay({ view: () => <CanvasView node={node} /> });
};

const CanvasView: Component<{ node: Node }> = (props) => (
  <svg width="100%" height="100%">
    <For each={state<Canvas>(props.node).shapes ?? []}>
      {(shape) => (
        <g transform={`translate(${state<Shape>(shape).x ?? 0}, ${state<Shape>(shape).y ?? 0})`}>
          <Dynamic component={state<Shape>(shape).view} />
        </g>
      )}
    </For>
  </svg>
);

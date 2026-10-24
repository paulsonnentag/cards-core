import { For, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { State, type Behavior, type Node } from "../core";
import { state, type Canvas, type Shape } from "../lib";

export default (({ request }) => {
  const shapes = () => request(State).read<Canvas>().shapes ?? [];
  request(State).put({ view: () => <CanvasView shapes={shapes()} /> });
}) satisfies Behavior;

// only positions shapes; each shape's view renders whatever it likes (HTML, its own svg, ...)
const CanvasView: Component<{ shapes: Node[] }> = (props) => (
  <div class="canvas">
    <For each={props.shapes}>
      {(shape) => (
        <div
          class="shape"
          data-node={shape.url}
          style={{ left: `${state<Shape>(shape).x ?? 0}px`, top: `${state<Shape>(shape).y ?? 0}px` }}
        >
          <Dynamic component={state<Shape>(shape).view} />
        </div>
      )}
    </For>
  </div>
);

import { For, type Component } from "solid-js";
import {
  message,
  state,
  State,
  type Behavior,
  type Node,
  type Point,
  type Tagged,
} from "core";
import { Child, placeIn, removeFrom } from "container";
import { elementOf } from "dom";

// x, y and scale are in the container's terms (pixels on a canvas, lng/lat on a map); the view is in plain pixels
export type Shape = Tagged & {
  x: number;
  y: number;
  scale?: number;
  view?: Component;
  dragging?: boolean | "over"; // put while it follows the pointer; "over": above a container that would take it
};
export type Container = Tagged & { children: Node[] }; // urls in the document, nodes when read
export type Canvas = Container & {
  objects?: Node[]; // non-visual objects, e.g. created by a Lookup with orCreate
  view?: Component; // put
};

// container protocol: Take a child out (bubbles from the child), Drop a node in (bubbles from what's under the
// drop point), Pan a surface's view. `client` is where the node's origin goes on screen, `scale` its size on screen.
// While dragging, Drop is also sent with phase "over" (would you take it? show it, change nothing) and "out" (the
// pointer moved on: stop showing it, and pass it on so every container up the way can).
export type TakeRequest = { node: Node };
export type Taken = { node: Node; scale?: number }; // scale: the size it should keep on screen, if not its current one
export type DropRequest = {
  node: Node;
  client: Point;
  scale: number;
  pointer?: Point; // where the pointer is, if not at the origin
  phase?: "over" | "out" | "drop"; // drop if not given
};
export type PanRequest = { delta: Point };

// whoever has nothing to say answers with the fallback
const Take = message<TakeRequest, Taken | undefined>(
  "container/take",
  () => undefined,
);
const Drop = message<DropRequest, Node["url"] | undefined>(
  "container/drop",
  () => undefined,
);
message<PanRequest, void>("container/pan", () => {});

// A surface in plain pixels: x and y are offsets from its top-left, scale is the size on screen.
export default (({ url, request, on }) => {
  const children = () => request(State).read<Canvas>().children ?? [];

  request(State).put({
    "@tags/surface": true,
    view: () => <CanvasView url={url} children={children()} />,
  });

  on(Drop, ({ node, client, scale, phase = "drop" }, next) => {
    if (phase === "out") return next();
    if (phase === "over") return url;
    const origin = elementOf(url)!.getBoundingClientRect();
    placeIn(request(State), node, {
      x: client.x - origin.left,
      y: client.y - origin.top,
      scale,
    });
    return url;
  });

  on(Take, ({ node }, next) =>
    removeFrom(request(State), node) ? { node } : next(),
  );
}) satisfies Behavior;

const CanvasView: Component<{ url: Node["url"]; children: Node[] }> = (
  props,
) => (
  <div class="canvas" data-node={props.url} data-pan>
    <For each={props.children}>
      {(child) => (
        <Child
          node={child}
          style={{
            left: `${state<Shape>(child).x ?? 0}px`,
            top: `${state<Shape>(child).y ?? 0}px`,
            transform: `scale(${state<Shape>(child).scale ?? 1})`,
          }}
        />
      )}
    </For>
  </div>
);

import { For, type Component, type JSX } from "solid-js";
import {
  message,
  state,
  State,
  type Behavior,
  type Node,
  type Tagged,
} from "core";
import { Child, placeIn } from "container";
import { elementOf } from "dom";
import type { User } from "./pointer";

export type Point = { x: number; y: number };
// x, y and scale are in the container's terms (pixels on a canvas, lng/lat on a map); the view is in plain pixels
export type Shape = Tagged & {
  x: number;
  y: number;
  scale?: number;
  view?: Component;
};
export type Container = Tagged & {
  children: Node[]; // urls in the document, nodes when read
  accepts?: string; // put: the tag a node needs to be dropped here
};
export type Canvas = Container & {
  objects?: Node[]; // non-visual objects, e.g. created by a Lookup with orCreate
  view?: Component; // put
  me?: Node; // put at bootstrap: the user at this keyboard
  present?: Node[]; // put by presence: the other users who have this canvas open
};

// container protocol: declare what you take with `accepts`, and place what's handed to you on Drop. The select
// tool sends Drop to the nearest container whose `accepts` the node carries; the pen sends it to a surface.
// `client` is where the node's origin goes on screen, `scale` its size on screen. Pan moves a surface's view.
export type DropRequest = {
  node: Node;
  client: Point;
  scale: number;
  pointer?: Point; // where the pointer is, if not at the origin
};
export type PanRequest = { delta: Point };

// whoever has nothing to say answers with the fallback
const Drop = message<DropRequest, Node["url"] | undefined>(
  "container/drop",
  () => undefined,
);
message<PanRequest, void>("container/pan", () => {});

// A surface in plain pixels: x and y are offsets from its top-left, scale is the size on screen.
export default (({ url, request, on }) => {
  const canvas = () => request(State).read<Canvas>();
  const pointers = () =>
    [canvas().me, ...(canvas().present ?? [])]
      .map((user) => user && state<User>(user).pointer)
      .filter((p): p is Node => Boolean(p));

  request(State).put({
    "@tags/surface": true,
    accepts: "shape",
    view: () => (
      <CanvasView
        url={url}
        children={canvas().children ?? []}
        pointers={pointers()}
      />
    ),
  });

  on(Drop, ({ node, client, scale }) => {
    const origin = elementOf(url)!.getBoundingClientRect();
    placeIn(request(State), node, {
      x: client.x - origin.left,
      y: client.y - origin.top,
      scale,
    });
    return url;
  });
}) satisfies Behavior;

// pointers come last so cursors and what they hold draw above every shape
const CanvasView: Component<{
  url: Node["url"];
  children: Node[];
  pointers: Node[];
}> = (props) => (
  <div class="canvas" data-node={props.url} data-pan>
    <For each={props.children}>
      {(child) => <Child node={child} style={placement(child)} />}
    </For>
    <For each={props.pointers}>
      {(pointer) => <Child node={pointer} style={placement(pointer)} />}
    </For>
  </div>
);

function placement(node: Node): JSX.CSSProperties {
  const s = state<Shape>(node);
  return {
    left: `${s.x ?? 0}px`,
    top: `${s.y ?? 0}px`,
    transform: `scale(${s.scale ?? 1})`,
  };
}

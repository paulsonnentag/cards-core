import { createEffect, createMemo, on, untrack } from "solid-js";
import { Node, State } from "../core";
import {
  lookup,
  lookupOrCreate,
  state,
  type Canvas,
  type Line,
  type Point,
  type Pointer,
  type Selection,
  type Shape,
} from "../lib";

type Pen = Shape & { stroke?: Node }; // stroke is an overlay

export default (node: Node) => {
  const pointer = createMemo(() => lookup(node, "pointer"));
  const active = () => {
    const selection = lookup(node, "selection");
    return selection ? state<Selection>(selection).tool?.url === node.url : false;
  };

  // only pointer changes drive the pen; everything else is read untracked so its own writes can't re-trigger it
  const input = createMemo(() => {
    const p = pointer();
    if (!p) return undefined;
    const { position, down } = state<Pointer>(p);
    return { surface: p.parent!, position, down };
  });

  createEffect(
    on(input, (now) =>
      untrack(() => {
        if (!now || !active()) return;
        const { surface, position, down } = now;
        const stroke = state<Pen>(node).stroke;

        if (down && position && !stroke) start(surface, position);
        else if (down && position && stroke) extend(stroke, position);
        else if (!down && stroke) node.request(State).overlay({ stroke: undefined });
      }),
    ),
  );

  node.request(State).overlay({
    view: () => (
      <g style={{ cursor: "pointer" }} onPointerDown={toggle}>
        <rect width={48} height={32} rx={4} fill={active() ? "black" : "white"} stroke="black" />
        <text
          x={24}
          y={21}
          text-anchor="middle"
          fill={active() ? "white" : "black"}
          font-family="sans-serif"
          font-size="13"
        >
          pen
        </text>
      </g>
    ),
  });

  function toggle() {
    const selection = lookupOrCreate(node, "selection");
    selection.request(State).overlay({ tool: active() ? undefined : node.url });
  }

  // draws onto whatever surface the pointer sits on
  function start(surface: Node, at: Point) {
    const line = Node.create<Line>({
      "@tags": { shape: true, line: true },
      x: at.x,
      y: at.y,
      points: [{ x: 0, y: 0 }],
      color: "black",
      width: 2,
    });
    surface.request(State).change((d: Canvas) => {
      d.shapes.push(line);
    });
    node.request(State).overlay({ stroke: line.url });
  }

  function extend(stroke: Node, at: Point) {
    stroke.request(State).change((d: Line) => {
      d.points.push({ x: at.x - d.x, y: at.y - d.y });
    });
  }
};

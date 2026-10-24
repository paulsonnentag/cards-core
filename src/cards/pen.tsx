import { createEffect, createMemo } from "solid-js";
import { Lookup, Node, State, type Behavior } from "../core";
import type { Canvas, Line, Point, Shape, Tool } from "../lib";
import { PointerDown, PointerMove, PointerUp } from "./pointer";
import { Toggle } from "./tool";

type Pen = Shape & Tool & { stroke?: Node }; // stroke is a put

export default (({ url, request }) => {
  request(State).put("@tags/tool", true);
  const selected = () => request(State).read<Pen>().selected ?? false;
  const pointer = createMemo(() => request(Lookup, { tag: "pointer" }));

  createEffect(() => {
    const p = pointer();
    if (!p) return;
    p.on(PointerDown, (e, next) => {
      if (e.claimedBy || !selected()) return next();
      start(e.surface, e.position);
      return url;
    });
    p.on(PointerMove, (e, next) => (e.claimedBy === url ? extend(e.position) : next()));
    p.on(PointerUp, (e, next) => (e.claimedBy === url ? request(State).put("stroke", undefined) : next()));
  });

  request(State).put("view", () => (
    <button class="btn" classList={{ active: selected() }} onPointerDown={() => request(Toggle)}>
      ✎ Pen
    </button>
  ));

  // draws onto whatever surface the pointer sits on
  function start(surface: Node, at: Point) {
    const line = Node.create<Line>({
      "@tags": { shape: true, line: true },
      x: at.x,
      y: at.y,
      points: [{ x: 0, y: 0 }],
      color: "#1d1d1f",
      width: 2,
    });
    surface.request(State).change((d: Canvas) => {
      d.shapes.push(line);
    });
    request(State).put("stroke", line.url);
  }

  function extend(at: Point) {
    request(State).read<Pen>().stroke?.request(State).change((d: Line) => {
      d.points.push({ x: at.x - d.x, y: at.y - d.y });
    });
  }
}) satisfies Behavior;

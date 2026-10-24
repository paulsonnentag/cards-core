import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createEffect, createMemo } from "solid-js";
import {
  hasTag,
  Lookup,
  message,
  Node,
  rootOf,
  State,
  type Behavior,
  type Point,
} from "core";
import { hit, isControl } from "dom";
import type { DropRequest, Shape } from "./canvas";
import type { Line } from "./line";
import type { PointerInput } from "./pointer";
import type { Tool } from "./tool";

const PointerDown = message<PointerInput, AutomergeUrl | undefined>(
  "pointer/down",
);
const PointerMove = message<PointerInput, void>("pointer/move");
const PointerUp = message<PointerInput, void>("pointer/up");
const Toggle = message<void, void>("tool/toggle");
const Drop = message<DropRequest, AutomergeUrl | undefined>("container/drop");

type Pen = Shape & Tool & { stroke?: Node; from?: Point }; // puts: the line being drawn and where it started on screen

export default (({ url, parent, request }) => {
  request(State).put("@tags/tool", true);
  const self = () => request(State).read<Pen>();
  const selected = () => self().selected ?? false;
  const pointer = createMemo(() => request(Lookup, { tag: "pointer" }));

  createEffect(() => {
    const p = pointer();
    if (!p) return;
    p.on(PointerDown, (e, next) => {
      if (e.claimedBy || !selected() || isControl(e.element)) return next();
      start(e);
      return url;
    });
    p.on(PointerMove, (e, next) =>
      e.claimedBy === url ? extend(e.client) : next(),
    );
    p.on(PointerUp, (e, next) =>
      e.claimedBy === url
        ? request(State).put({ stroke: undefined, from: undefined })
        : next(),
    );
  });

  request(State).put("view", () => (
    <button
      class="btn"
      classList={{ active: selected() }}
      onClick={() => request(Toggle)}
    >
      ✎ Pen
    </button>
  ));

  // the surface under the pointer decides where the line lives; points are screen pixels from the start
  function start(e: PointerInput) {
    const root = rootOf(parent!);
    const surface = surfaceOf(hit(root, e.element)) ?? root;
    const line = Node.create<Line>({
      "@tags": { shape: true, line: true },
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }],
      color: "#1d1d1f",
      width: 2,
    });
    surface.request(Drop, { node: line, client: e.client, scale: 1 });
    request(State).put({ stroke: line.url, from: e.client });
  }

  function extend(client: Point) {
    const { stroke, from } = self();
    if (!stroke || !from) return;
    stroke.request(State).change((d: Line) => {
      d.points.push({ x: client.x - from.x, y: client.y - from.y });
    });
  }
}) satisfies Behavior;

// the nearest node tagged `surface`, from `node` up
function surfaceOf(node: Node): Node | undefined {
  for (let n: Node | undefined = node; n; n = n.parent)
    if (hasTag(n, "surface")) return n;
  return undefined;
}

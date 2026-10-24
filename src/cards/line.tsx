import { State, type Behavior } from "core";
import type { Point, Shape } from "./canvas";

export type Line = Shape & { points: Point[]; color: string; width: number };

export default (({ request }) => {
  const line = () => request(State).read<Line>();
  const points = () =>
    (line().points ?? []).map((p) => `${p.x},${p.y}`).join(" ");

  request(State).put({
    view: () => (
      <svg class="line" width="1" height="1">
        <polyline
          points={points()}
          stroke={line().color}
          stroke-width={line().width}
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        {/* a wider invisible stroke, so thin lines are easy to grab */}
        <polyline
          class="hit"
          points={points()}
          stroke="transparent"
          stroke-width={line().width + 10}
          fill="none"
        />
      </svg>
    ),
  });
}) satisfies Behavior;

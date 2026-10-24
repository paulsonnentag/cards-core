import { State, type Behavior } from "../core";
import type { Line } from "../lib";

export default (({ request }) => {
  const line = () => request(State).read<Line>();

  request(State).put({
    view: () => (
      <svg class="line" width="1" height="1">
        <polyline
          points={(line().points ?? []).map((p) => `${p.x},${p.y}`).join(" ")}
          stroke={line().color}
          stroke-width={line().width}
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
    ),
  });
}) satisfies Behavior;

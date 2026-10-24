import { State, type Node } from "../core";
import { state, type Line } from "../lib";

export default (node: Node) => {
  const line = () => state<Line>(node);

  node.request(State).overlay({
    view: () => (
      <polyline
        points={(line().points ?? []).map((p) => `${p.x},${p.y}`).join(" ")}
        stroke={line().color}
        stroke-width={line().width}
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        pointer-events="none"
      />
    ),
  });
};

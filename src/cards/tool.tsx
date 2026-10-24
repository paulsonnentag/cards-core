import { createEffect, createMemo } from "solid-js";
import { Lookup, message, State, type Behavior } from "../core";
import { state, type Selection } from "../lib";

// sent by a tool to its own node to select or deselect itself
export const Toggle = message<void, void>("tool/toggle", () => {});

// Applied to anything tagged `tool`: keeps `selected` put on the node, from the shared selection object.
export default (({ url, request, on }) => {
  const selected = createMemo(() => {
    const selection = request(Lookup, { tag: "selection" });
    return selection ? state<Selection>(selection).tool?.url === url : false;
  });

  createEffect(() => request(State).put("selected", selected()));

  on(Toggle, () => {
    const selection = request(Lookup, { tag: "selection", orCreate: {} })!;
    selection.request(State).put("tool", selected() ? undefined : url);
  });
}) satisfies Behavior;

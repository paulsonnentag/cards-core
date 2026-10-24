import { createEffect, createMemo } from "solid-js";
import {
  hasTag,
  Lookup,
  message,
  state,
  State,
  type Behavior,
  type Node,
  type Tagged,
} from "core";

export type Tool = Tagged & { selected?: boolean }; // put by the tool card
export type Selection = Tagged & { tool?: Node }; // tool is a put

// sent by a tool to its own node to select or deselect itself
const Toggle = message<void, void>("tool/toggle", () => {});

// Applied to anything tagged `tool`: keeps `selected` put on the node, from the shared selection object.
// A tool tagged `default` is selected whenever no other tool is. Tools only act while they sit on a surface,
// so the examples inside cards stay inert.
export default (({ url, parent, request, on }) => {
  const selection = createMemo(() => request(Lookup, { tag: "selection" }));
  const onSurface = () => Boolean(parent && hasTag(parent, "surface"));
  const isDefault = () =>
    Boolean(request(State).read<Partial<Tagged>>()["@tags"]?.default);

  const selected = createMemo(() => {
    if (!onSurface()) return false;
    const tool = selection() && state<Selection>(selection()!).tool;
    return tool ? tool.url === url : isDefault();
  });

  createEffect(() => request(State).put("selected", selected()));

  on(Toggle, () => {
    const s = request(Lookup, { tag: "selection", orCreate: {} })!;
    const tool = state<Selection>(s).tool;
    if (selected() && !tool) return; // the default tool can't be switched off
    s.request(State).put("tool", selected() ? undefined : url);
  });
}) satisfies Behavior;

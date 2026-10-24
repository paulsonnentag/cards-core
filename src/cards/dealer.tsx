import { createEffect, createMemo, createResource, For, mapArray, onCleanup, untrack, type Component } from "solid-js";
import { State, type Behavior, type Node } from "../core";
import { hasTag, state, tint, type Applied, type Canvas, type Card, type Dealer } from "../lib";

const modules = import.meta.glob<{ default: Behavior }>("./*.tsx");

export default (({ parent, request }) => {
  const surface = parent!; // the dealer deals onto whatever it is placed on
  const cards = () => request(State).read<Dealer>().cards ?? [];
  const matches = createMemo(() => matchCards(surface, cards()));
  const keys = createMemo(() => [...matches().keys()].sort(), [], { equals: sameArray });
  const pair = (key: string) => untrack(() => matches().get(key)!);

  createEffect(
    mapArray(keys, (key) => {
      const { target, card } = pair(key);
      const [behavior] = createResource(() => state<Card>(card).module, loadBehavior);
      createEffect(() => {
        const b = behavior();
        if (b) onCleanup(target.attach(b, card.url));
      });
    }),
  );

  const applied = () => keys().map(pair);
  createEffect(() => request(State).put({ applied: applied() }));
  request(State).put({ view: () => <DealerView applied={applied()} /> });
}) satisfies Behavior;

const DealerView: Component<{ applied: Applied[] }> = (props) => (
  <div class="panel" style={{ width: "220px" }}>
    <div class="titlebar">
      <span>Dealer</span>
      <span class="grip" />
    </div>
    <div class="scroll" style={{ padding: "4px 0 6px" }}>
      <For each={props.applied}>
        {(a) => (
          <div class="dealt">
            <span class="chip" style={{ "--chip": tint(state<Card>(a.card).name) }}>
              {state<Card>(a.card).name}
            </span>
            <span class="muted">on {a.target.url.slice(-6)}</span>
          </div>
        )}
      </For>
    </div>
  </div>
);

function matchCards(surface: Node, cards: Node[]): Map<string, Applied> {
  const targets = [surface, ...(state<Canvas>(surface).shapes ?? [])];
  const matches = new Map<string, Applied>();

  for (const target of targets) {
    for (const card of cards) {
      const tag = state<Card>(card).appliesTo;
      if (tag && hasTag(target, tag)) matches.set(`${target.url}|${card.url}`, { target, card });
    }
  }
  return matches;
}

async function loadBehavior(path: string): Promise<Behavior | undefined> {
  const load = modules[path];
  if (!load) {
    console.warn(`unknown card module ${path}`);
    return undefined;
  }
  return (await load()).default;
}

function sameArray(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

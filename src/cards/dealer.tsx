import { createEffect, createMemo, createResource, For, mapArray, onCleanup, untrack, type Component } from "solid-js";
import { State, type Behavior, type Node } from "../core";
import { hasTag, state, type Applied, type Canvas, type Card, type Dealer } from "../lib";

const modules = import.meta.glob<{ default: Behavior }>("./*.tsx");

export default (node: Node) => {
  const surface = node.parent!; // the dealer deals onto whatever it is placed on
  const matches = createMemo(() => matchCards(surface, node));
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

  createEffect(() => node.request(State).overlay({ applied: keys().map(pair) }));
  node.request(State).overlay({ view: () => <DealerView node={node} /> });
};

const DealerView: Component<{ node: Node }> = (props) => {
  const applied = () => state<Dealer>(props.node).applied ?? [];

  return (
    <g pointer-events="none" font-family="sans-serif" font-size="12">
      <text y={12} font-weight="bold">
        dealer
      </text>
      <For each={applied()}>
        {(a, i) => (
          <text y={30 + i() * 16}>
            {state<Card>(a.card).name} → {a.target.url.slice(-6)}
          </text>
        )}
      </For>
    </g>
  );
};

function matchCards(surface: Node, dealer: Node): Map<string, Applied> {
  const targets = [surface, ...(state<Canvas>(surface).shapes ?? [])];
  const cards = state<Dealer>(dealer).cards ?? [];
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

import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  mapArray,
  onCleanup,
  untrack,
} from "solid-js";
import { compile } from "./compile";
import type { Canvas } from "./cards/canvas";
import type { Card } from "./cards/card";
import type { Deck } from "./cards/deck";
import { hasTag, Node, state, State, type Behavior } from "./core";

type Applied = { target: Node; card: Node };

// Attached to the root. Every card on the canvas, loose or on a deck, applies to every node in the tree that
// carries the tag it matches; when a card leaves the canvas, a target loses the tag, or the source changes,
// that attachment is disposed, which removes its handlers and puts.
export const dealer: Behavior = (root) => {
  const cards = createMemo(() => {
    const loose = state<Canvas>(root).children ?? [];
    const decked = loose
      .filter((c) => hasTag(c, "deck"))
      .flatMap((d) => state<Deck>(d).children ?? []);
    return [...loose, ...decked].filter((c) => hasTag(c, "card"));
  });
  // the same object for the same key across runs, so mapArray keeps unchanged attachments
  const known = new Map<string, Applied>();
  const applied = createMemo(
    () => {
      const next = match(cards(), nodesUnder(root));
      for (const key of known.keys()) if (!next.has(key)) known.delete(key);
      for (const [key, pair] of next) if (!known.has(key)) known.set(key, pair);
      return [...next.keys()].sort().map((key) => known.get(key)!);
    },
    [],
    { equals: sameArray },
  );

  createEffect(
    mapArray(applied, ({ target, card }) => {
      const source = untrack(() => state<Card>(card).source);
      try {
        onCleanup(target.attach(compile(source), card.url));
      } catch (error) {
        console.error(
          `card ${state<Card>(card).title} failed on ${target.url}`,
          error,
        );
      }
    }),
  );

  createEffect(() => root.request(State).put("applied", applied()));
};

function match(cards: Node[], targets: Node[]): Map<string, Applied> {
  const matches = new Map<string, Applied>();
  for (const card of cards) {
    const { matches: tag, source } = state<Card>(card);
    if (!tag || !source) continue;
    for (const target of targets) {
      // keyed by where the target sits too, so a node that moves containers is attached again with its new parent
      const key = `${target.parent?.url}|${target.url}|${card.url}|${hash(source)}`;
      if (hasTag(target, tag)) matches.set(key, { target, card });
    }
  }
  return matches;
}

// every node reachable from the root through node values in state, each once, first path wins
function nodesUnder(root: Node): Node[] {
  const seen = new Set<AutomergeUrl>();
  const out: Node[] = [];
  const queue = [root];
  for (let node = queue.shift(); node; node = queue.shift()) {
    if (seen.has(node.url)) continue;
    seen.add(node.url);
    out.push(node);
    for (const value of Object.values(state<Record<string, unknown>>(node))) {
      for (const v of Array.isArray(value) ? value : [value])
        if (v instanceof Node) queue.push(v);
    }
  }
  return out;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function sameArray<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

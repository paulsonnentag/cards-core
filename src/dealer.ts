import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
  untrack,
} from "solid-js";
import { compile } from "./compile";
import type { Card } from "./cards/card";
import type { Pointer } from "./cards/pointer";
import { hasTag, state, State, walk, type Behavior, type Node } from "./core";

type Applied = { target: Node; card: Node };

// a node someone else drops leaves their hand (a presence message) before its new container arrives (a document
// sync); attachments of what was in a hand wait this long for it to reappear rather than detaching in between
const LINGER = 500;

// Attached to the root. Every card in the tree (loose, on a deck, in someone's hand) applies to every node in the
// tree that carries the tag it matches; when a card leaves the tree, a target loses the tag, or the source changes,
// that attachment is disposed, which removes its handlers and puts. A node that moves keeps its attachments.
export const dealer: Behavior = (root) => {
  // the same object for the same key across runs, so mapArray keeps unchanged attachments
  const known = new Map<string, Applied>();
  const lingering = new Map<string, number>(); // key -> until when it waits
  let held = new Set<AutomergeUrl>(); // what was in a hand on the last run
  const [expiry, setExpiry] = createSignal(0);
  const applied = createMemo(
    () => {
      expiry();
      const nodes = walk(root);
      const cards = nodes.filter((n) => hasTag(n, "card"));
      const next = match(cards, nodes);
      const now = performance.now();
      for (const [key, pair] of known) {
        if (next.has(key)) lingering.delete(key);
        else if (lingering.has(key) || wasHeld(pair)) {
          const until = lingering.get(key) ?? now + LINGER;
          // a little late, so the run it wakes always finds the wait over
          if (!lingering.has(key))
            setTimeout(() => setExpiry((n) => n + 1), LINGER + 20);
          if (until > now) {
            lingering.set(key, until);
            next.set(key, pair);
          } else lingering.delete(key);
        }
      }
      held = inHands(nodes);
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

  function wasHeld({ card, target }: Applied) {
    return held.has(card.url) || held.has(target.url);
  }
};

// what every pointer in the tree holds
function inHands(nodes: Node[]): Set<AutomergeUrl> {
  const out = new Set<AutomergeUrl>();
  for (const node of nodes) {
    const holding = hasTag(node, "pointer") && state<Pointer>(node).holding;
    if (holding) out.add(holding.url);
  }
  return out;
}

function match(cards: Node[], targets: Node[]): Map<string, Applied> {
  const matches = new Map<string, Applied>();
  for (const card of cards) {
    const { matches: tag, source } = state<Card>(card);
    if (!tag || !source) continue;
    for (const target of targets) {
      const key = `${target.url}|${card.url}|${hash(source)}`;
      if (hasTag(target, tag)) matches.set(key, { target, card });
    }
  }
  return matches;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function sameArray<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
  type Accessor,
} from "solid-js";
import {
  Describe,
  hasTag,
  Pointers,
  state,
  State,
  walk,
  type Behavior,
  type Card,
  type CardDescriptor,
  type Node,
} from "@cards/core";
import type { Loader } from "@cards/loader";

// what a package's entry module exports
type PackageModule = { cards?: CardDescriptor[] };
type Applied = { target: Node; card: Node; descriptor: CardDescriptor };

// a node someone else drops leaves their hand (a presence message) before its new container arrives (a document
// sync); attachments of what was in a hand wait this long for it to reappear rather than detaching in between
const LINGER = 500;

// Attached to the root. Every card in the tree (loose, on a deck, in someone's hand) names a descriptor in a
// package; the dealer watches that package through the loader and applies the descriptor's behavior to every node
// in the tree that carries the tag it matches. When a card leaves the tree, a target loses the tag, or the package
// loads a new version, that attachment is disposed, which removes its handlers and puts. A node that moves keeps
// its attachments.
export function dealer(loader: Loader): Behavior {
  return (root) => {
    const packages = createPackages(loader);
    onCleanup(packages.stop);
    root.on(Describe, (_, __, from) => descriptorOf(from));

    // the same object for the same key across runs, so mapArray keeps unchanged attachments
    const known = new Map<string, Applied>();
    const lingering = new Map<string, number>(); // key -> until when it waits
    let held = new Set<AutomergeUrl>(); // what was in a hand on the last run
    const [expiry, setExpiry] = createSignal(0);
    const applied = createMemo(
      () => {
        expiry();
        const nodes = walk(root);
        const next = match(
          nodes.filter((n) => hasTag(n, "card")),
          nodes,
        );
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
        held = inHands(root.request(Pointers) ?? []);
        for (const key of known.keys()) if (!next.has(key)) known.delete(key);
        for (const [key, pair] of next)
          if (!known.has(key)) known.set(key, pair);
        return [...next.keys()].sort().map((key) => known.get(key)!);
      },
      [],
      { equals: sameArray },
    );

    createEffect(mapArray(applied, attach));

    createEffect(() =>
      root.request(State).put(
        "applied",
        applied().map(({ target, card }) => ({ target, card })),
      ),
    );

    function descriptorOf(card: Node): CardDescriptor | undefined {
      const qualified = state<Card>(card).card;
      const i = qualified?.lastIndexOf("#") ?? -1;
      if (!qualified || i < 0) return undefined;
      const pkg = qualified.slice(0, i) as AutomergeUrl;
      const id = qualified.slice(i + 1);
      return packages
        .get(pkg)()
        ?.cards?.find((d) => d.id === id);
    }

    function match(cards: Node[], targets: Node[]): Map<string, Applied> {
      const matches = new Map<string, Applied>();
      for (const card of cards) {
        const descriptor = descriptorOf(card);
        if (!descriptor) continue;
        for (const target of targets) {
          const key = `${target.url}|${card.url}|${versionOf(descriptor)}`;
          if (hasTag(target, descriptor.matches))
            matches.set(key, { target, card, descriptor });
        }
      }
      return matches;
    }

    function wasHeld({ card, target }: Applied) {
      return held.has(card.url) || held.has(target.url);
    }
  };
}

// a behavior module loads on first use; the attachment is gone if it was disposed before that
function attach({ target, card, descriptor }: Applied) {
  let detach: (() => void) | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    detach?.();
  });
  descriptor
    .behavior()
    .then(({ default: behavior }) => {
      if (disposed) return;
      detach = target.attach(behavior, {
        url: card.url,
        accepts: descriptor.accepts,
      });
    })
    .catch((error) =>
      console.error(`card ${descriptor.title} failed on ${target.url}`, error),
    );
}

// each package as its latest module, watched from first use until the dealer goes
function createPackages(loader: Loader) {
  const modules = new Map<AutomergeUrl, Accessor<PackageModule | undefined>>();
  const stops: (() => void)[] = [];
  return {
    get(url: AutomergeUrl): Accessor<PackageModule | undefined> {
      let module = modules.get(url);
      if (!module) {
        const [read, set] = createSignal<PackageModule>();
        stops.push(loader.watch<PackageModule>(url, (m) => set(() => m)));
        modules.set(url, (module = read));
      }
      return module;
    },
    stop() {
      for (const stop of stops) stop();
    },
  };
}

// a new module means new descriptors, so attachments made from an old one are replaced
const versions = new WeakMap<CardDescriptor, number>();
let nextVersion = 0;
function versionOf(descriptor: CardDescriptor): number {
  let version = versions.get(descriptor);
  if (version === undefined)
    versions.set(descriptor, (version = nextVersion++));
  return version;
}

// what every pointer holds
function inHands(pointers: Node[]): Set<AutomergeUrl> {
  const out = new Set<AutomergeUrl>();
  for (const pointer of pointers) {
    const holding = state<{ holding?: Node }>(pointer).holding;
    if (holding) out.add(holding.url);
  }
  return out;
}

function sameArray<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

import type { AutomergeUrl } from "@automerge/automerge-repo";
import { message, type Message } from "./messages";
import type { Behavior, Node } from "./node";
import type { Tagged } from "./tree";

// a card in the tree: which descriptor of which package it deals
export type Card = Tagged & {
  card?: string; // tag(package, descriptor id): a string, not a node, so the package isn't walked as part of the tree
  example?: Node; // an instance to drag out as a copy
};

// what a package's entry module exports, per card, in `cards`
export type CardDescriptor = {
  id: string;
  title: string;
  description: string;
  matches: string; // the tag it is dealt to
  accepts: Message<any, any>[]; // every message its behavior registers a handler for, on any node
  behavior: () => Promise<{ default: Behavior }>;
  example?: (node: Node) => Node; // a new instance for the card to show, created with NewNode from `node`
};

// the descriptor of the card that asks, from its package as loaded now; answered at the root by the dealer
export const Describe = message<void, CardDescriptor | undefined>(
  "core/describe",
);

export function card(descriptor: CardDescriptor): CardDescriptor {
  return descriptor;
}

// tags and messages are owned by the package whose url they carry; `#`, because State paths split on `/`
export function tag(pkg: AutomergeUrl, name: string): string {
  return `${pkg}#${name}`;
}

// the package a module was loaded from, without heads, so every version has the same tags and messages. Reads the
// loader's pinned prefix, `/<encodeURIComponent("automerge:<id>#<heads>")>@<digest>/`
export function packageUrl(moduleUrl: string): AutomergeUrl {
  const [segment] = new URL(moduleUrl).pathname.split("/")[1].split("@");
  return decodeURIComponent(segment).split("#")[0] as AutomergeUrl;
}

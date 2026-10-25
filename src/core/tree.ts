import type { AutomergeUrl } from "@automerge/automerge-repo";
import { message } from "./messages";
import { Node, setParents } from "./node";
import { state } from "./state";

export type Tagged = { "@tags": Record<string, true> };

// the nearest node tagged `tag`, checking each ancestor and its direct children, as seen by the requester.
// With `orCreate`, a missing object is created in the root's `objects` from that template.
export const Lookup = message<
  { tag: string; orCreate?: Record<string, unknown> },
  Node | undefined
>("core/lookup");

export function rootOf(node: Node): Node {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

export function hasTag(node: Node, tag: string): boolean {
  return Boolean(state<Partial<Tagged>>(node)["@tags"]?.[tag]);
}

// nodes referenced from a node's state, directly or in a list
export function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  for (const value of Object.values(state<Record<string, unknown>>(node))) {
    for (const v of Array.isArray(value) ? value : [value])
      if (v instanceof Node) out.push(v);
  }
  return out;
}

// every node reachable from the root through node values in state, each once, first path wins. Walking also
// records where each node sits, which is what `parent` answers from; so whoever walks first, the parents are
// right for what they do next
export function walk(root: Node): Node[] {
  const parents = new Map<AutomergeUrl, AutomergeUrl | undefined>([
    [root.url, undefined],
  ]);
  const nodes: Node[] = [];
  const queue = [root];
  for (let node = queue.shift(); node; node = queue.shift()) {
    nodes.push(node);
    for (const child of childNodes(node)) {
      if (parents.has(child.url)) continue;
      parents.set(child.url, node.url);
      queue.push(child);
    }
  }
  setParents(parents);
  return nodes;
}

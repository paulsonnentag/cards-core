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

// a new document from `initial`, stored at once, as a node in the requester's scope. Nodes in `initial` are stored
// as references, so a document can be made with others nested in it
export const NewNode = message<Record<string, unknown>, Node>("core/new-node");

// a node with no document: `initial` plus puts, in this tab only. Every tab computes its own, so one is placed with
// a put, never by storing its url; `State.persisted` tells it apart
export const NewComputedNode = message<Record<string, unknown>, Node>(
  "core/new-computed-node",
);

export function rootOf(node: Node): Node {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

export function hasTag(node: Node, tag: string): boolean {
  return Boolean(state<Partial<Tagged>>(node)["@tags"]?.[tag]);
}

// nodes referenced from a node's state, stored or put alike: in a field, in a list, or in a record of nodes such
// as `children`. Not in an object that holds anything else: a tool's press holds a node among other values, and
// that node isn't a child
export function childNodes(node: Node): Node[] {
  return Object.values(state<Record<string, unknown>>(node)).flatMap(nodesIn);
}

export function nodesIn(value: unknown): Node[] {
  if (value instanceof Node) return [value];
  if (Array.isArray(value)) return value.filter((v) => v instanceof Node);
  if (value === null || typeof value !== "object") return [];
  const values = Object.values(value);
  return values.length > 0 && values.every((v) => v instanceof Node)
    ? values
    : [];
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

import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { Point } from "./cards/canvas";
import { childNodes, type Node } from "./core";

// the deepest node rendered at `element`, reached through state from `root`. Previews (marked data-inert) count as
// what shows them, so nothing draws or drops into an example; pass `previews` to reach into them, e.g. to drag one out.
export function hit(
  root: Node,
  element: Element | null,
  { previews = false } = {},
): Node {
  const inert = previews ? null : element?.closest("[data-inert]");
  const urls: string[] = [];
  for (
    let el = (inert?.parentElement ?? element)?.closest("[data-node]");
    el;
    el = el.parentElement?.closest("[data-node]")
  ) {
    urls.unshift(el.getAttribute("data-node")!);
  }
  let node = root;
  for (const url of urls) {
    if (url === node.url) continue;
    const next = childNodes(node).find((c) => c.url === url);
    if (!next) break;
    node = next;
  }
  return node;
}

// the element for a node whose top-left is the node's origin; the innermost one if it is marked more than once
export function elementOf(
  url: AutomergeUrl,
  near?: Element | null,
): HTMLElement | undefined {
  const selector = `[data-node="${url}"]`;
  const outer = (near?.closest(selector) ??
    document.querySelector(selector)) as HTMLElement | null;
  return (
    ((outer?.querySelector(selector) as HTMLElement | null) ?? outer) ||
    undefined
  );
}

// what is on screen at `client`, looking through the node being dragged
export function elementAt(
  client: Point,
  ignore?: AutomergeUrl,
): Element | undefined {
  return document
    .elementsFromPoint(client.x, client.y)
    .find((el) => !ignore || !el.closest(`[data-node="${ignore}"]`));
}

export function isControl(element: Element): boolean {
  return Boolean(
    element.closest("button, input, textarea, select, a, [contenteditable]"),
  );
}

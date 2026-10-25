import {
  createEffect,
  createRoot,
  onCleanup,
  splitProps,
  type Component,
  type JSX,
} from "solid-js";
import { insert } from "solid-js/web";
import { hasTag, rootOf, state, State, type Node } from "./core";
import type { Canvas, Container, Shape } from "./cards/canvas";
import type { User } from "./cards/pointer";

// renders a node inside its container; data-node is how the pointer finds nodes again
export const Child: Component<{ node: Node; style?: JSX.CSSProperties }> = (
  props,
) => (
  <View
    class="child"
    node={props.node}
    style={props.style}
    data-node={props.node.url}
  />
);

// Shows a node's view. A view is built once per node and moved to wherever the node is shown, with moveBefore
// where the browser has it, so moving a node between containers keeps its elements, transitions and focus.
export const View: Component<
  JSX.HTMLAttributes<HTMLDivElement> & {
    node: Node;
    ref?: (el: HTMLDivElement) => void;
  }
> = (props) => {
  const [own, rest] = splitProps(props, ["node", "ref"]);
  let slot!: HTMLDivElement;
  // an effect, not a render effect: by then the slot is in the document, which moveBefore needs
  createEffect(() => {
    const el = built(own.node);
    const previous = slot.firstChild;
    if (previous && previous !== el) move(previous, lot());
    if (el && el.parentNode !== slot) move(el, slot);
  });
  onCleanup(() => {
    const el = slot.firstChild;
    if (el) move(el, lot());
  });
  return (
    <div
      {...rest}
      ref={(el) => {
        slot = el;
        own.ref?.(el);
      }}
    />
  );
};

type Built = { view: Component; el: ChildNode; dispose(): void };
const views = new Map<Node["url"], Built>();

// the node's view as one element, rebuilt only when the card that draws it puts a different view
function built(node: Node): ChildNode | undefined {
  const view = state<Shape>(node).view;
  const old = views.get(node.url);
  if (old && old.view === view) return old.el;
  old?.dispose();
  old?.el.remove();
  views.delete(node.url);
  if (!view) return undefined;
  const entry = createRoot((dispose) => ({
    view,
    el: element(view({})),
    dispose,
  }));
  views.set(node.url, entry);
  return entry.el;
}

// a view that isn't a single element (text, a fragment) gets a box of its own, so it moves as one
function element(rendered: JSX.Element): ChildNode {
  if (rendered instanceof Element) return rendered;
  const box = document.createElement("div");
  box.style.display = "contents";
  insert(box, rendered);
  return box;
}

function move(el: ChildNode, into: HTMLElement) {
  if ("moveBefore" in into && el.isConnected && into.isConnected)
    (into as Movable).moveBefore(el, null);
  else into.appendChild(el);
}

// where views wait between slots: in the document, so moveBefore can take them out again, and laid out at their
// real size, so a view that measures itself while waiting (a map resizing) doesn't see zero
let parked: HTMLElement | undefined;
function lot(): HTMLElement {
  if (!parked) {
    parked = document.createElement("div");
    parked.inert = true;
    Object.assign(parked.style, {
      position: "fixed",
      left: "-100000px",
      top: "0",
      visibility: "hidden",
    });
    document.body.appendChild(parked);
  }
  return parked;
}

type Movable = HTMLElement & {
  moveBefore(node: globalThis.Node, child: globalThis.Node | null): void;
};

// the pointer of the user at this keyboard, as seen from anywhere in the tree
export function myPointer(node: Node): Node | undefined {
  const me = state<Canvas>(rootOf(node)).me;
  return me && state<User>(me).pointer;
}

// the nearest container, from `from` up, whose `accepts` tag `node` carries
export function taker(from: Node, node: Node): Node | undefined {
  for (let n: Node | undefined = from; n; n = n.parent) {
    const accepts = state<Partial<Container>>(n).accepts;
    if (accepts && hasTag(node, accepts)) return n;
  }
  return undefined;
}

// adds `node` to the container's children (if it isn't there yet) and sets where it sits. With `at`, it ends up
// at that index, counted without it, so a child already there is moved
export function placeIn(
  container: State<Container>,
  node: Node,
  fields: Record<string, unknown>,
  at?: number,
) {
  container.change((d) => {
    if (!d.children) d.children = [];
    const i = d.children.findIndex(
      (c) => (c as unknown as string) === node.url,
    );
    if (at === undefined) {
      if (i < 0) d.children.push(node);
    } else if (i !== at) {
      if (i >= 0) d.children.splice(i, 1);
      d.children.splice(Math.min(at, d.children.length), 0, node);
    }
  });
  if (Object.keys(fields).length === 0) return;
  const child = container.read().children.find((c) => c.url === node.url)!;
  child.request(State).change((d: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(fields)) d[key] = value;
  });
}

// removes `node` from the container's children; false if it wasn't one
export function removeFrom(container: State<Container>, node: Node): boolean {
  const i = (container.read().children ?? []).findIndex(
    (c) => c.url === node.url,
  );
  if (i < 0) return false;
  container.change((d) => {
    d.children.splice(i, 1);
  });
  return true;
}

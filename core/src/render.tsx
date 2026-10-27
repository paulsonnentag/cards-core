import {
  createEffect,
  createRoot,
  onCleanup,
  splitProps,
  type Component,
  type JSX,
} from "solid-js";
import { insert } from "solid-js/web";
import { state, type Node } from "./index";

// what View reads: the card that draws a node puts its view there
export type Viewed = { view?: Component };

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
    if (el.parentNode !== slot) move(el, slot);
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

// the node's view as one element, rebuilt only when the card that draws it puts a different view. A node no card
// draws (yet) is a box with a question mark
function built(node: Node): ChildNode {
  const view = state<Viewed>(node).view ?? Unknown;
  const old = views.get(node.url);
  if (old && old.view === view) return old.el;
  old?.dispose();
  old?.el.remove();
  views.delete(node.url);
  const entry = createRoot((dispose) => ({
    view,
    el: element(view({})),
    dispose,
  }));
  views.set(node.url, entry);
  return entry.el;
}

const Unknown: Component = () => <div class="unknown">?</div>;

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

import { createEffect, Show, type Component } from "solid-js";
import { state, State, type Behavior, type Node } from "core";
import { View } from "container";
import type { Shape } from "./canvas";

export type Card = Shape & {
  schema?: Node;
  title: string;
  description: string;
  matches: string; // the tag this card applies to
  example?: Node; // a template: dragged out of the card as a copy
  source: string; // TSX whose default export is the Behavior
};

const BOX = 140;

// Renders every card: its title, its description, and an example that drags out as a copy.
export default (({ request }) => {
  const card = () => request(State).read<Card>();

  request(State).put("view", () => <CardView card={card()} />);

  // the example is a template: the select tool leaves it here and drops a copy
  createEffect(() =>
    card().example?.request(State).put("@tags/template", true),
  );
}) satisfies Behavior;

const CardView: Component<{ card: Card }> = (props) => (
  <div class="paper card">
    <h3 class="card-title">{props.card.title}</h3>
    <div class="card-body">
      <Show when={props.card.example}>
        {(example) => (
          <div class="example" data-node={example().url} data-inert>
            <Preview example={example()} />
          </div>
        )}
      </Show>
      <p class="description">{props.card.description}</p>
    </div>
  </div>
);

// the example's own view, scaled down to fit the box
const Preview: Component<{ example: Node }> = (props) => {
  let content!: HTMLDivElement;

  createEffect(() => {
    state<Shape>(props.example);
    requestAnimationFrame(() => fit(content));
  });

  return (
    <View
      class="example-content"
      node={props.example}
      ref={(el) => (content = el)}
    />
  );
};

function fit(content: HTMLElement) {
  content.style.transform = "none";
  const origin = content.getBoundingClientRect();
  const box = bounds(content);
  if (!box) return;
  const scale = Math.min(1, (BOX - 20) / box.width, (BOX - 20) / box.height);
  const dx = (BOX - box.width * scale) / 2 - (box.left - origin.left) * scale;
  const dy = (BOX - box.height * scale) / 2 - (box.top - origin.top) * scale;
  content.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
}

// what an element draws, including descendants that overflow it (a line's svg is 1×1)
function bounds(el: Element): DOMRect | undefined {
  let box: DOMRect | undefined;
  for (const r of [el, ...el.querySelectorAll("*")].map((e) =>
    e.getBoundingClientRect(),
  )) {
    if (r.width === 0 && r.height === 0) continue;
    if (!box) box = DOMRect.fromRect(r);
    else {
      const left = Math.min(box.left, r.left);
      const top = Math.min(box.top, r.top);
      box = new DOMRect(
        left,
        top,
        Math.max(box.right, r.right) - left,
        Math.max(box.bottom, r.bottom) - top,
      );
    }
  }
  return box;
}

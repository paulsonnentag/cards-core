import { createEffect, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { message, state, State, type Behavior, type Node } from "core";
import type { Shape, TakeRequest, Taken } from "./canvas";

export type Card = Shape & {
  schema?: Node;
  title: string;
  description: string;
  matches: string; // the tag this card applies to
  example?: Node; // dragged out of the card as a copy
  source: string; // TSX whose default export is the Behavior
};

const Take = message<TakeRequest, Taken | undefined>("container/take");

const BOX = 140;

// Renders every card: its title, its description, and an example that drags out as a copy.
export default (({ request, on }) => {
  const card = () => request(State).read<Card>();

  request(State).put("view", () => <CardView card={card()} />);

  // taking the example leaves it here and hands out a full-size copy
  on(Take, ({ node }, next): Taken | undefined =>
    node.url === card().example?.url
      ? { node: node.request(State).clone(), scale: 1 }
      : next(),
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
    <div class="example-content" data-node={props.example.url} ref={content}>
      <Dynamic component={state<Shape>(props.example).view} />
    </div>
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

import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, For, Show, type Component } from "solid-js";
import { message, rootOf, state, State, type Behavior, type Node } from "core";
import { Child, myPointer, placeIn } from "container";
import { elementOf } from "dom";
import type { Container, DropRequest, Point, Shape } from "./canvas";
import type { Card } from "./card";
import type { Pointer } from "./pointer";

export type Deck = Shape &
  Container & {
    selected?: Node; // put
  };
type Dropping = { node: Node; index: number }; // a card held over the deck, and the slot it would land in

const Drop = message<DropRequest, AutomergeUrl | undefined>("container/drop");

const ROW = 28; // a row and the gap below it; rows are placed by hand so they can slide

// Holds cards: listed on the left, the selected one shown on the right. Cards on a deck are dealt like loose ones.
export default (({ url, parent, request, on }) => {
  const deck = () => request(State).read<Deck>();
  const cards = () => deck().children ?? [];
  const selected = () =>
    cards().find((c) => c.url === deck().selected?.url) ?? cards()[0];
  const select = (card: Node) => request(State).put("selected", card.url);

  // what my pointer holds over this deck, if anything
  const dropping = createMemo((): Dropping | undefined => {
    const pointer = myPointer(parent!);
    if (!pointer) return;
    const { holding, grip, position } = state<Pointer>(pointer);
    if (!holding || grip?.over?.url !== url || !position) return;
    // the position is in the root surface's pixels
    const surface = elementOf(rootOf(parent!).url)?.getBoundingClientRect();
    if (!surface) return;
    const client = {
      x: position.x + surface.left,
      y: position.y + surface.top,
    };
    return { node: holding, index: slotAt(client) };
  });

  request(State).put({
    accepts: "card",
    view: () => (
      <DeckView
        cards={cards()}
        selected={selected()}
        dropping={dropping()}
        select={select}
      />
    ),
  });

  on(Drop, ({ node, client, pointer = client }) => {
    placeIn(request(State), node, {}, slotAt(pointer));
    select(node);
    return url;
  });

  // the slot nearest to the pointer
  function slotAt(pointer: Point): number {
    const rows = elementOf(url)?.querySelector(".deck-rows") as HTMLElement;
    if (!rows) return cards().length;
    const rect = rows.getBoundingClientRect();
    const scale = rows.offsetWidth ? rect.width / rows.offsetWidth : 1;
    const top = (pointer.y - rect.top) / scale - ROW / 2;
    return clamp(Math.round(top / ROW), 0, cards().length);
  }
}) satisfies Behavior;

const DeckView: Component<{
  cards: Node[];
  selected?: Node;
  dropping?: Dropping;
  select(card: Node): void;
}> = (props) => {
  const count = () => props.cards.length + (props.dropping ? 1 : 0);
  // the rows make room at the slot a card would land in
  const top = (card: Node) => {
    const i = props.cards.indexOf(card);
    return (props.dropping && i >= props.dropping.index ? i + 1 : i) * ROW;
  };

  return (
    <div class="paper deck" classList={{ droppable: Boolean(props.dropping) }}>
      <div class="deck-list">
        <div class="deck-rows" style={{ height: `${count() * ROW}px` }}>
          <For each={props.cards}>
            {(card) => (
              <div
                class="deck-row"
                classList={{ selected: props.selected === card }}
                data-node={card.url}
                style={{ transform: `translateY(${top(card)}px)` }}
                onClick={() => props.select(card)}
              >
                {state<Card>(card).title}
              </div>
            )}
          </For>
          <Show when={props.dropping}>
            {(dropping) => (
              <div
                class="deck-row placeholder"
                style={{ transform: `translateY(${dropping().index * ROW}px)` }}
              >
                {state<Card>(dropping().node).title}
              </div>
            )}
          </Show>
        </div>
        <Show when={count() === 0}>
          <p class="empty">Drop cards here</p>
        </Show>
      </div>
      <div class="deck-pane">
        <Show when={props.selected}>{(card) => <Child node={card()} />}</Show>
      </div>
    </div>
  );
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

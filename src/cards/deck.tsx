import type { AutomergeUrl } from "@automerge/automerge-repo";
import { For, Show, type Component } from "solid-js";
import {
  hasTag,
  message,
  state,
  State,
  type Behavior,
  type Node,
  type Point,
} from "core";
import { Child, placeIn, removeFrom } from "container";
import { elementOf } from "dom";
import type {
  Container,
  DropRequest,
  Shape,
  TakeRequest,
  Taken,
} from "./canvas";
import type { Card } from "./card";

export type Deck = Shape &
  Container & {
    selected?: Node; // put
    dropping?: { node: Node; index: number; top: number }; // put while a card hovers: its slot, and where a held row is
  };

const Take = message<TakeRequest, Taken | undefined>("container/take");
const Drop = message<DropRequest, AutomergeUrl | undefined>("container/drop");

const ROW = 28; // a row and the gap below it; rows are placed by hand so they can slide

// Holds cards: listed on the left, the selected one shown on the right. Cards on a deck are dealt like loose ones.
// A card dragged within the deck stays a row and reorders; it only becomes a card again once it leaves.
export default (({ url, request, on }) => {
  const deck = () => request(State).read<Deck>();
  const cards = () => deck().children ?? [];
  const selected = () =>
    cards().find((c) => c.url === deck().selected?.url) ?? cards()[0];
  const select = (card: Node) => request(State).put("selected", card.url);

  request(State).put("view", () => (
    <DeckView
      cards={cards()}
      selected={selected()}
      dropping={deck().dropping}
      select={select}
    />
  ));

  on(Drop, ({ node, client, pointer = client, phase = "drop" }, next) => {
    if (phase === "out" || !hasTag(node, "card")) {
      if (deck().dropping) request(State).put("dropping", undefined);
      return next();
    }
    const { index, top } = slotAt(node, pointer);
    if (phase === "over") {
      request(State).put("dropping", { node, index, top });
      return url;
    }
    request(State).put("dropping", undefined);
    placeIn(request(State), node, {}, index);
    select(node);
    return url;
  });

  on(Take, ({ node }, next) =>
    removeFrom(request(State), node) ? { node, scale: 1 } : next(),
  );

  // a row held at the pointer, and the slot nearest to it, counted without `node`
  function slotAt(node: Node, pointer: Point) {
    const rows = elementOf(url)!.querySelector(".deck-rows") as HTMLElement;
    const rect = rows.getBoundingClientRect();
    const scale = rows.offsetWidth ? rect.width / rows.offsetWidth : 1;
    const others = cards().filter((c) => c.url !== node.url).length;
    const top = clamp(
      (pointer.y - rect.top) / scale - ROW / 2,
      0,
      others * ROW,
    );
    return { index: Math.round(top / ROW), top };
  }
}) satisfies Behavior;

const DeckView: Component<{
  cards: Node[];
  selected?: Node;
  dropping?: Deck["dropping"];
  select(card: Node): void;
}> = (props) => {
  const held = () =>
    props.cards.find((c) => c.url === props.dropping?.node.url);
  const others = () => props.cards.filter((c) => c !== held());
  const count = () => others().length + (props.dropping ? 1 : 0);
  // the others make room at the slot a card would land in
  const top = (card: Node) => {
    if (card === held()) return props.dropping!.top;
    const i = others().indexOf(card);
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
                classList={{
                  selected: props.selected === card,
                  held: held() === card,
                }}
                data-node={card.url}
                style={{ transform: `translateY(${top(card)}px)` }}
                onClick={() => props.select(card)}
              >
                {state<Card>(card).title}
              </div>
            )}
          </For>
          <Show when={!held() && props.dropping}>
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

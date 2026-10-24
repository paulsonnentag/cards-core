import {
  isValidAutomergeUrl,
  Repo,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { Dynamic, render } from "solid-js/web";
import type { Canvas, Shape } from "./cards/canvas";
import type { Card } from "./cards/card";
import type { Deck } from "./cards/deck";
import type { Line } from "./cards/line";
import type { Camera, MapShape } from "./cards/map";
import type { User } from "./cards/pointer";
import { backend, Node, state } from "./core";
import { dealer } from "./dealer";
import { presence } from "./presence";
import "./theme.css";

// only read when seeding a new canvas; after that a card's source lives in its document
const sources = import.meta.glob<string>("./cards/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const BERLIN: Camera = { center: [13.388, 52.517], zoom: 9.5 };
const SYNC_SERVER =
  import.meta.env.VITE_SYNC_SERVER ?? "wss://sync3.automerge.org";

// other tabs see each other directly; other browsers through the sync server
const repo = new Repo({
  storage: new IndexedDBStorageAdapter(),
  network: [
    new BroadcastChannelNetworkAdapter(),
    new WebSocketClientAdapter(SYNC_SERVER),
  ],
});
const root = new Node(canvasUrl());

root.attach(backend(repo));
root.attach(dealer);
root.attach(presence(repo, userUrl()));

render(
  () => <Dynamic component={state<Canvas>(root).view} />,
  document.getElementById("app")!,
);

if (import.meta.env.DEV) Object.assign(globalThis, { root });

function canvasUrl(): AutomergeUrl {
  const existing = location.hash.slice(1);
  if (isValidAutomergeUrl(existing)) return existing;

  const url = createCanvas();
  location.hash = url;
  return url;
}

// the user at this keyboard, with their pointer; one per tab, so two tabs are two cursors
function userUrl(): AutomergeUrl {
  const existing = sessionStorage.getItem("user");
  if (isValidAutomergeUrl(existing)) return existing;

  const url = create<User>({
    "@tags": { user: true },
    pointer: create<Shape>({ ...tags("pointer"), x: 0, y: 0 }),
  });
  sessionStorage.setItem("user", url);
  return url;
}

type Seed = {
  file: string;
  title: string;
  description: string;
  matches: string;
  example?: AutomergeUrl;
};

// the root is the one document created outside a change; everything else is placed via Node.create
function createCanvas(): AutomergeUrl {
  const cards = [
    seed(
      "canvas",
      "Canvas",
      "A surface in plain pixels. Positions its children; each child draws itself.",
      "canvas",
    ),
    seed(
      "card",
      "Card",
      "Shows a card with its example. Drag the example out to make a copy.",
      "card",
      untitledCard(),
    ),
    seed(
      "pointer",
      "Pointer",
      "Every user's cursor, and what it holds. Yours turns presses on the canvas into pointer events; a subscriber can claim a press.",
      "pointer",
    ),
    seed(
      "tool",
      "Tool",
      "Selection for anything tagged tool. A default tool takes over when none is selected.",
      "tool",
    ),
    seed(
      "select",
      "Select",
      "The default tool. Drag things to move them between containers, drag a surface to pan it.",
      "select",
      shape("select"),
    ),
    seed(
      "deck",
      "Deck",
      "Holds cards. Drop cards onto it; the cards on a deck stay active.",
      "deck",
      create<Deck>({ ...tags("deck"), x: 0, y: 0, children: [] }),
    ),
    seed(
      "pen",
      "Pen",
      "A tool that draws lines onto whatever surface you press.",
      "pen",
      shape("pen"),
    ),
    seed(
      "line",
      "Line",
      "Draws a polyline through its points.",
      "line",
      exampleLine(),
    ),
    seed(
      "inspector",
      "Inspector",
      "A tool that picks a node and shows where it sits in the hierarchy and its data.",
      "inspector",
      shape("inspector"),
    ),
    seed(
      "map",
      "Map",
      "A surface on a map. Things drawn or dropped onto it stick to their place.",
      "map",
      map(300, 200),
    ),
  ].map((s) => card(s, { x: 0, y: 0 }));

  const select = create<Shape>({
    "@tags": { shape: true, select: true, default: true },
    x: 16,
    y: 16,
  });
  const pen = create<Shape>({ ...tags("pen"), x: 112, y: 16 });
  const inspector = create<Shape>({ ...tags("inspector"), x: 16, y: 64 });
  const deck = create<Deck>({
    ...tags("deck"),
    x: 340,
    y: 16,
    children: cards,
  });
  const berlin = create<MapShape>({
    ...tags("map"),
    x: 340,
    y: 346,
    width: 600,
    height: 380,
    camera: BERLIN,
    children: [],
  });

  return create<Canvas>({
    "@tags": { canvas: true },
    children: [select, pen, inspector, deck, berlin],
  });
}

function seed(
  file: string,
  title: string,
  description: string,
  matches: string,
  example?: AutomergeUrl,
): Seed {
  return { file, title, description, matches, example };
}

function card({ file, example, ...seed }: Seed, at: { x: number; y: number }) {
  const source = sources[`./cards/${file}.tsx`];
  return create<Card>({
    ...tags("card"),
    ...at,
    ...seed,
    source,
    ...(example ? { example } : {}),
  });
}

// the Card card's example: a blank card to start a new one from
function untitledCard() {
  return create<Card>({
    ...tags("card"),
    x: 0,
    y: 0,
    title: "Untitled",
    description:
      "A new card. Give it a tag to match and a behavior in its source.",
    matches: "untitled",
    source:
      'import type { Behavior } from "core";\n\nexport default (() => {}) satisfies Behavior;\n',
  });
}

function exampleLine() {
  return create<Line>({
    ...tags("line"),
    x: 0,
    y: 0,
    points: [
      { x: 0, y: 30 },
      { x: 25, y: 0 },
      { x: 50, y: 30 },
      { x: 75, y: 0 },
      { x: 100, y: 30 },
    ],
    color: "#1d1d1f",
    width: 3,
  });
}

function map(width: number, height: number) {
  return create<MapShape>({
    ...tags("map"),
    x: 0,
    y: 0,
    width,
    height,
    camera: BERLIN,
    children: [],
  });
}

function shape(tag: string) {
  return create<Shape>({ ...tags(tag), x: 0, y: 0 });
}

function tags(tag: string) {
  return { "@tags": { shape: true, [tag]: true } as Record<string, true> };
}

function create<T>(initial: Stored<T>): AutomergeUrl {
  return repo.create(initial).url;
}

// what a document looks like on disk: node references are urls
type Stored<T> = {
  [K in keyof T]: T[K] extends Node[]
    ? AutomergeUrl[]
    : T[K] extends Node | undefined
      ? AutomergeUrl
      : T[K];
};

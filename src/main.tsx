import { isValidAutomergeUrl, Repo, type AutomergeUrl } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { createEffect, createMemo, createRoot, mapArray, onCleanup } from "solid-js";
import { Dynamic, render } from "solid-js/web";
import dealer from "./cards/dealer";
import { backend, Node } from "./core";
import { hasTag, state, type Canvas, type Card, type Dealer, type Shape } from "./lib";

const repo = new Repo({ storage: new IndexedDBStorageAdapter() });
const root = new Node(canvasUrl());

root.attach(backend(repo));

// bootstrap: attach every dealer placed on the root; dealers attach everything else
createRoot(() => {
  const dealers = createMemo(() => (state<Canvas>(root).shapes ?? []).filter((s) => hasTag(s, "dealer")));
  createEffect(mapArray(dealers, (d) => onCleanup(d.attach(dealer))));
});

render(() => <Dynamic component={state<Canvas>(root).view} />, document.getElementById("app")!);

if (import.meta.env.DEV) Object.assign(globalThis, { root });

function canvasUrl(): AutomergeUrl {
  const existing = location.hash.slice(1);
  if (isValidAutomergeUrl(existing)) return existing;

  const url = createCanvas();
  location.hash = url;
  return url;
}

// the root is the one document created outside a change; everything else is placed via Node.create
function createCanvas(): AutomergeUrl {
  const cards = ["canvas", "pointer", "pen", "line"].map(card);
  const pointer = create<Shape>({ "@tags": { shape: true, pointer: true }, x: 0, y: 0 });
  const pen = create<Shape>({ "@tags": { shape: true, pen: true }, x: 16, y: 16 });
  const dealer = create<Dealer>({ "@tags": { shape: true, dealer: true }, x: 16, y: 72, cards });
  // the pointer goes first so it renders underneath every other shape
  return create<Canvas>({ "@tags": { canvas: true }, shapes: [pointer, pen, dealer] });
}

function card(name: string) {
  return create<Card>({ "@tags": { card: true }, name, appliesTo: name, module: `./${name}.tsx` });
}

function create<T>(initial: Stored<T>): AutomergeUrl {
  return repo.create(initial).url;
}

// what a document looks like on disk: node references are urls
type Stored<T> = { [K in keyof T]: T[K] extends Node[] ? AutomergeUrl[] : T[K] };

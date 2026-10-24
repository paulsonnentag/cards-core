import type { Component } from "solid-js";
import { State, type Node } from "./core";

export type Point = { x: number; y: number };
export type Tagged = { "@tags": Record<string, true> };
export type Shape = Tagged & { x: number; y: number; view?: Component };
export type Line = Shape & { points: Point[]; color: string; width: number };
export type Canvas = Tagged & {
  shapes: Node[]; // urls in the document, nodes when read
  objects?: Node[]; // non-visual objects, e.g. created by a Lookup with orCreate
  view?: Component; // put
};
export type Pointer = Shape & { position?: Point; claimedBy?: Node }; // puts
export type Tool = Tagged & { selected?: boolean }; // put by the tool card
export type Selection = Tagged & { tool?: Node }; // tool is a put
export type Card = Tagged & { name: string; appliesTo: string; module: string };
export type Applied = { target: Node; card: Node };
export type Dealer = Shape & { cards: Node[]; applied?: Applied[] };

export function state<T>(node: Node): T {
  return node.request(State).read();
}

export function hasTag(node: Node, tag: string): boolean {
  return Boolean(state<Partial<Tagged>>(node)["@tags"]?.[tag]);
}

// a stable pastel for a name, so a card has the same color everywhere
export function tint(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 85% 86%)`;
}

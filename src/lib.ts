import type { Component } from "solid-js";
import { Lookup, State, type Node } from "./core";

export type Point = { x: number; y: number };
export type Tagged = { "@tags": Record<string, true> };
export type Shape = Tagged & { x: number; y: number; view?: Component };
export type Line = Shape & { points: Point[]; color: string; width: number };
export type Canvas = Tagged & {
  shapes: Node[]; // urls in the document, nodes when read
  objects?: Node[]; // non-visual objects, e.g. created by lookupOrCreate
  view?: Component; // overlay
};
export type Pointer = Shape & { position?: Point; down?: boolean }; // position and down are overlays
export type Selection = Tagged & { tool?: Node }; // tool is an overlay
export type Card = Tagged & { name: string; appliesTo: string; module: string };
export type Applied = { target: Node; card: Node };
export type Dealer = Shape & { cards: Node[]; applied?: Applied[] };

export function state<T>(node: Node): T {
  return node.request(State).read();
}

export function hasTag(node: Node, tag: string): boolean {
  return Boolean(state<Partial<Tagged>>(node)["@tags"]?.[tag]);
}

export function lookup(node: Node, tag: string): Node | undefined {
  return node.request(Lookup, { tag });
}

export function lookupOrCreate(node: Node, tag: string, initial: Record<string, unknown> = {}): Node {
  return node.request(Lookup, { tag, orCreate: initial })!;
}

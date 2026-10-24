import { message } from "./messages";
import type { Node, Process } from "./node";

// the one state message, answered by the backend at the root: an object's state as the requesting process sees it
export const State = message<void, State>("core/state");

export type State<T = any> = {
  read<R = T>(): R; // stored value with puts applied; urls come back as nodes
  change(fn: (doc: T) => void): void; // write to the stored value, attributed to the requesting card
  // ephemeral values at a "/"-separated path, in this process's layer; undefined removes the put
  put(path: string, value: unknown): void;
  put(values: Record<string, unknown>): void; // several paths at once
  overlays(): Record<string, Overlay>; // every path that has a put
  overlays(path: string): Overlay | undefined; // just that path
  clone(): Node; // a fresh copy of the stored value, without puts; place it by assigning it in a change
};

export type Overlay = {
  stored?: unknown;
  layers: { process: Process; value: unknown; seq: number }[]; // newest first
};

export function state<T>(node: Node): T {
  return node.request(State).read();
}

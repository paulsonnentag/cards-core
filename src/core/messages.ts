import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createSignal, type Signal } from "solid-js";
import type { Node } from "./node";

export type Message<Req, Res> = string & { __req?: Req; __res?: Res };
export type Handler<Req, Res> = (
  req: Req,
  next: (req?: Req) => Res,
  from: Node,
) => Res;
export type Entry = { type: string; handler: Handler<any, any> };

export function message<Req, Res>(type: string): Message<Req, Res> {
  return type as Message<Req, Res>;
}

// `here`'s handlers (newest first), then its ancestors'; undefined if none answers. A node that hangs from
// nothing still reaches its scope's root, so what isn't placed yet can ask the backend for its state
export function dispatch(
  here: Node | undefined,
  type: string,
  req: unknown,
  from: Node,
): any {
  if (!here) return undefined;
  const own = registry(here.url)[0]()
    .filter((e) => e.type === type)
    .map((e) => e.handler);
  return run(0, req);

  function run(i: number, r: unknown): any {
    if (i < own.length) return own[i](r, (next = r) => run(i + 1, next), from);
    return dispatch(up(here!), type, r, from);
  }
}

function up(node: Node): Node | undefined {
  const root = node.scope.root;
  return node.parent ?? (root && root.url !== node.url ? root : undefined);
}

// the handlers registered on a node, by url
export function registry(url: AutomergeUrl): Signal<Entry[]> {
  return (
    handlers.get(url) ?? handlers.set(url, createSignal<Entry[]>([])).get(url)!
  );
}

const handlers = new Map<AutomergeUrl, Signal<Entry[]>>();

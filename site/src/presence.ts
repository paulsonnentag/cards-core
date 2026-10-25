import type {
  AutomergeUrl,
  DocHandle,
  PeerId,
  Repo,
} from "@automerge/automerge-repo";
import { createEffect, onCleanup, untrack } from "solid-js";
import {
  childNodes,
  MyPointer,
  Node,
  nodeIn,
  Pointers,
  state,
  State,
  whenReady,
  type Behavior,
} from "@cards/core";

// what presence puts on the root: me at bootstrap, the others as they come and go
type Present = { me?: Node; present?: Node[] };
type User = { pointer?: Node };

// what one user shares: the puts on their user document and its pointer, by node and path
type Snapshot = {
  user: AutomergeUrl;
  nodes: Record<AutomergeUrl, Record<string, unknown>>;
  leaving?: boolean;
};

// Attached to the root. Puts `me` on the root, and shares the puts on my user and pointer with everyone who has
// this canvas open, as ephemeral messages on the canvas document. Theirs arrive as ordinary puts on their nodes,
// and `present` on the root lists who is here; MyPointer and Pointers answer with their pointers, so cards never
// read users. Happy path only: a user who vanishes mid-drag is gone when their peer disconnects, and whatever they
// held goes with them.
export function presence(repo: Repo, me: AutomergeUrl): Behavior {
  return (root) => {
    root.request(State).put("me", me);
    root.on(MyPointer, (_, __, from) => pointerOf(from, me));
    root.on(Pointers, (_, __, from) =>
      [me, ...(state<Present>(root).present ?? []).map((u) => u.url)]
        .map((user) => pointerOf(from, user))
        .filter((p): p is Node => Boolean(p)),
    );

    const peers = new Map<PeerId, AutomergeUrl>(); // who each connected peer is
    const applied = new Map<AutomergeUrl, Record<string, string[]>>(); // paths put per node, per user
    let handle: DocHandle<unknown> | undefined;
    let pending: Snapshot | undefined;
    let scheduled = false;

    // the canvas may not be here yet (opened by url before any peer with it connected): join once it is
    whenReady(repo, root.url, (h) => {
      handle = h;
      h.on("ephemeral-message", ({ senderId, message }) =>
        receive(senderId, message as Snapshot),
      );
      send();
    });
    const resend = () => send();
    const leave = () =>
      handle?.broadcast({ user: me, nodes: {}, leaving: true });
    repo.networkSubsystem.on("peer", resend);
    repo.networkSubsystem.on("peer-disconnected", forget);
    window.addEventListener("pagehide", leave);
    onCleanup(() => {
      repo.networkSubsystem.off("peer", resend);
      repo.networkSubsystem.off("peer-disconnected", forget);
      window.removeEventListener("pagehide", leave);
      leave();
    });

    // whenever one of my puts changes, send everything again, at most once a frame. Only my own nodes are
    // tracked: `present` on the root changes whenever someone else sends, and must not make me answer
    createEffect(() => {
      pending = snapshot();
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        send();
      });
    });

    function snapshot(): Snapshot {
      const user = untrack(() => state<Present>(root).me);
      const nodes: Snapshot["nodes"] = {};
      for (const node of user ? [user, ...childNodes(user)] : []) {
        const puts: Record<string, unknown> = {};
        for (const [path, overlay] of Object.entries(
          node.request(State).overlays(),
        )) {
          const value = plain(overlay.layers[0].value);
          if (value !== undefined) puts[path] = value;
        }
        nodes[node.url] = puts;
      }
      return { user: me, nodes };
    }

    function send() {
      if (!handle) return;
      handle.broadcast(pending ?? untrack(snapshot));
    }

    function receive(peer: PeerId, { user, nodes, leaving }: Snapshot) {
      if (user === me) return;
      if (leaving) {
        peers.delete(peer);
        if (![...peers.values()].includes(user)) drop(user);
      } else {
        // a peer heard from for the first time may have missed my hello while still loading: answer it
        if (!peers.has(peer)) send();
        peers.set(peer, user);
        apply(user, nodes);
      }
      announce();
    }

    function forget({ peerId }: { peerId: PeerId }) {
      const user = peers.get(peerId);
      if (!user) return;
      peers.delete(peerId);
      if (![...peers.values()].includes(user)) drop(user);
      announce();
    }

    // replaces what `user` had put with what they put now; paths no longer there are cleared
    function apply(user: AutomergeUrl, nodes: Snapshot["nodes"]) {
      const before = applied.get(user) ?? {};
      const after: Record<string, string[]> = {};
      for (const url of new Set([
        ...Object.keys(before),
        ...Object.keys(nodes),
      ])) {
        const puts = nodes[url as AutomergeUrl] ?? {};
        const values: Record<string, unknown> = {};
        for (const path of before[url] ?? []) values[path] = undefined;
        Object.assign(values, puts);
        nodeFor(url as AutomergeUrl)
          .request(State)
          .put(values);
        after[url] = Object.keys(puts);
      }
      applied.set(user, after);
    }

    function drop(user: AutomergeUrl) {
      apply(user, {});
      applied.delete(user);
    }

    function announce() {
      root.request(State).put("present", [...new Set(peers.values())]);
    }

    // a node by url in my scope; it reaches the backend through the root even before its user is listed
    function nodeFor(url: AutomergeUrl): Node {
      return nodeIn(root.scope, url);
    }
  };
}

// a user's pointer as a node in the requester's scope, so it is bound to their process
function pointerOf(from: Node, user: AutomergeUrl): Node | undefined {
  return state<User>(nodeIn(from.scope, user)).pointer;
}

// a put as it travels: nodes become urls, functions (views) stay home
function plain(value: unknown): unknown {
  if (value instanceof Node) return value.url;
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = plain(v);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return value;
}

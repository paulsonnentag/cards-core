import * as A from "@automerge/automerge";
import {
  generateAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import {
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from "solid-js";
import {
  dispatch,
  registry,
  type Entry,
  type Handler,
  type Message,
} from "./messages";

export type Process = AutomergeUrl | undefined; // the card acting; undefined = bootstrap
export type Behavior = (node: Node) => void;

export class Node {
  constructor(
    readonly url: AutomergeUrl,
    readonly parent?: Node,
    readonly process?: Process,
    readonly owner: Owner | null = null,
  ) {}

  // a complete document that is not stored anywhere yet; assign it inside a change to place it
  static create<T>(initial: T): Node {
    const url = generateAutomergeUrl();
    fresh.set(url, A.from(initial as any));
    return new Node(url);
  }

  // methods are arrow fields so behaviors can destructure them: ({ request, on }) => …

  // handlers live as long as the computation that registered them, or else the process
  on = <Req, Res>(msg: Message<Req, Res>, handler: Handler<Req, Res>): void => {
    const [, set] = registry(this.url);
    const entry: Entry = { type: msg, handler };
    set((hs) => [entry, ...hs]);
    runWithOwner(getOwner() ?? this.owner, () =>
      onCleanup(() => set((hs) => hs.filter((h) => h !== entry))),
    );
  };

  // bubbles up: this node's handlers (newest first), then its ancestors'
  request = <Req, Res>(msg: Message<Req, Res>, req?: Req): Res =>
    dispatch(this, msg, req, this);

  attach = (behavior: Behavior, card?: AutomergeUrl): (() => void) =>
    createRoot((dispose) => {
      behavior(rebind(this, card, getOwner()));
      return dispose;
    });
}

// the document Node.create made for `url`, handed out once, when it is first placed
export function takeFresh(url: AutomergeUrl): A.Doc<any> | undefined {
  const doc = fresh.get(url);
  fresh.delete(url);
  return doc;
}

// the same position in the tree, seen by another process
function rebind(node: Node, process: Process, owner: Owner | null): Node {
  const parent = node.parent && rebind(node.parent, process, owner);
  return new Node(node.url, parent, process, owner);
}

const fresh = new Map<AutomergeUrl, A.Doc<any>>(); // created, not yet placed in a document

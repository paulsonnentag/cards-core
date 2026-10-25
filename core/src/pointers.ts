import { message } from "./messages";
import type { Node } from "./node";

// answered at the root by presence, with nodes in the requester's scope: the pointer of the user at this keyboard,
// and the pointers of everyone who has this canvas open, mine first
export const MyPointer = message<void, Node | undefined>("core/my-pointer");
export const Pointers = message<void, Node[]>("core/pointers");

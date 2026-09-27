import type { MessageId } from "@workspace/contract/schemas/common";
import type {
  BranchPath,
  Message,
  MessageNode,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";

// Branch navigation over the message tree (D25, LibreChat's model). A
// conversation is a tree linked by `parentId`; what the user sees is the path
// from the root to one leaf. Editing or regenerating adds a sibling, and the
// switcher (‹ 2/3 ›) moves between siblings. Pure functions over the
// content-free tree (`messages.tree`), so they run before any content loads.

export type TreeNode = Pick<MessageNode, "createdAt" | "id" | "parentId">;

const byCreated = (a: TreeNode, b: TreeNode): number =>
  a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);

/** Children of every node (key `null` for roots), oldest first. */
export const childrenIndex = (
  nodes: readonly TreeNode[]
): ReadonlyMap<MessageId | null, readonly TreeNode[]> => {
  const index = new Map<MessageId | null, TreeNode[]>();
  for (const node of nodes) {
    const siblings = index.get(node.parentId) ?? [];
    siblings.push(node);
    index.set(node.parentId, siblings);
  }
  for (const siblings of index.values()) {
    siblings.sort(byCreated);
  }
  return index;
};

/** A message's siblings (itself included) and where it sits among them. */
export const siblingsOf = (
  nodes: readonly TreeNode[],
  id: MessageId
): SiblingInfo | undefined => {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) {
    return;
  }
  const siblingIds = (childrenIndex(nodes).get(node.parentId) ?? []).map(
    (sibling) => sibling.id
  );
  return { index: siblingIds.indexOf(id), messageId: id, siblingIds };
};

/**
 * The leaf a branch switch lands on: from `id`, keep taking the newest child.
 * That's where the conversation on that branch last got to.
 */
export const newestLeafUnder = (
  nodes: readonly TreeNode[],
  id: MessageId
): MessageId => {
  const children = childrenIndex(nodes);
  let current = id;
  const seen = new Set<MessageId>();
  // `seen` guards against a malformed tree with a cycle.
  while (!seen.has(current)) {
    seen.add(current);
    const next = children.get(current)?.at(-1);
    if (!next) {
      return current;
    }
    current = next.id;
  }
  return current;
};

/** Ids from the root to `leafId`, or `undefined` if the leaf isn't in the tree. */
export const buildBranchPath = (
  nodes: readonly TreeNode[],
  leafId: MessageId
): readonly MessageId[] | undefined => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: MessageId[] = [];
  let current = byId.get(leafId);
  while (current) {
    if (path.includes(current.id)) {
      return;
    }
    path.push(current.id);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path.length > 0 ? path.reverse() : undefined;
};

/** The sibling `delta` away, or `null` past either end (the switcher doesn't wrap). */
export const stepSibling = (
  info: SiblingInfo,
  delta: -1 | 1
): MessageId | null => info.siblingIds[info.index + delta] ?? null;

/** Whether a message has other branches to switch to. */
export const hasBranches = (info: SiblingInfo | undefined): boolean =>
  info !== undefined && info.siblingIds.length > 1;

/**
 * The fork the header's switcher and `[` / `]` act on: the deepest message on
 * the path that has siblings, i.e. the most recent point the chat branched.
 */
export const activeFork = (
  siblings: readonly SiblingInfo[]
): SiblingInfo | null => {
  for (let index = siblings.length - 1; index >= 0; index -= 1) {
    const info = siblings[index];
    if (hasBranches(info)) {
      return info ?? null;
    }
  }
  return null;
};

/**
 * A `BranchPath` built from messages already in hand, the same shape
 * `messages.path` returns: for demos, tests and optimistic updates before the
 * server answers.
 */
export const localBranchPath = (
  messages: readonly Message[],
  leafId: MessageId | null
): BranchPath | undefined => {
  const conversationId = messages[0]?.conversationId;
  if (conversationId === undefined || leafId === null) {
    return;
  }
  const ids = buildBranchPath(messages, leafId);
  if (!ids) {
    return;
  }
  const byId = new Map(messages.map((message) => [message.id, message]));
  const children = childrenIndex(messages);
  const onPath = ids.flatMap((id) => {
    const message = byId.get(id);
    return message ? [message] : [];
  });
  return {
    conversationId,
    leafId,
    messages: onPath,
    siblings: onPath.map((message) => {
      const siblingIds = (children.get(message.parentId) ?? []).map(
        (sibling) => sibling.id
      );
      return {
        index: siblingIds.indexOf(message.id),
        messageId: message.id,
        siblingIds,
      };
    }),
  };
};

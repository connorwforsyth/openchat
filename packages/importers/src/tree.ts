import type { MessageStatus } from "@workspace/contract/schemas/messages";
import { err, ok, type Result } from "@workspace/shared/result";

import type { ImportedMessage } from "./schema";

// Shared tree work for every importer, ported from LibreChat's import lineage
// helpers (`createChatGptLineage`, `orderMessageLineage`, `cloneLineage`;
// MIT, see NOTICE). Exports are untrusted: parents may be missing, hidden,
// cyclic or younger than their children, and the stored tree must be none of
// those (a child written before its parent would break "the newest message
// is a leaf").

/** One export node before the tree is resolved. */
export interface DraftMessage {
  /**
   * `null` passes the node over (a system prompt, a hidden node, an empty
   * message): its children attach to its nearest kept ancestor instead.
   */
  readonly body: DraftBody | null;
  readonly parentSourceId: string | null;
  readonly sourceId: string;
}

export type DraftBody = Omit<
  ImportedMessage,
  "createdAt" | "parentSourceId" | "sourceId"
> & {
  /** Epoch milliseconds; `null` when the export has none. */
  readonly createdAtMs: number | null;
};

export interface BuiltTree {
  /** Parents before children; every child strictly younger than its parent. */
  readonly messages: readonly ImportedMessage[];
  /** The kept message a source id stands for: itself, or its nearest kept ancestor. */
  readonly resolve: (sourceId: string | null | undefined) => string | null;
}

// `Date` can represent far more than an ISO timestamp can spell; keep to years 0000-9999.
const MAX_MS = 253_402_300_799_999;

/** A usable epoch-ms instant, or `null`. */
export const validMs = (ms: number | null | undefined): number | null =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_MS
    ? Math.trunc(ms)
    : null;

/** Epoch ms from an ISO string (or anything `Date` parses), or `null`. */
export const msFromString = (
  value: string | null | undefined
): number | null => (value ? validMs(Date.parse(value)) : null);

/**
 * Resolves drafts into a tree: passed-over nodes are skipped, parent cycles
 * are cut, and timestamps are nudged so each child sorts after its parent.
 * `fallbackMs` dates a root the export didn't date. The first draft with a
 * given id wins.
 */
export const buildTree = (
  drafts: readonly DraftMessage[],
  fallbackMs: number
): BuiltTree => {
  const byId = new Map<string, DraftMessage>();
  const order = new Map<string, number>();
  for (const draft of drafts) {
    if (!byId.has(draft.sourceId)) {
      byId.set(draft.sourceId, draft);
      order.set(draft.sourceId, order.size);
    }
  }

  // Memoised, so a long run of passed-over ancestors is walked once for the
  // whole conversation rather than once per descendant.
  const resolved = new Map<string, string | null>();
  const resolve = (start: string | null | undefined): string | null => {
    const walked: string[] = [];
    const seen = new Set<string>();
    let result: string | null = null;
    let id = start ?? null;
    while (id !== null) {
      const known = resolved.get(id);
      if (known !== undefined) {
        result = known;
        break;
      }
      const draft = byId.get(id);
      if (!draft || seen.has(id)) {
        break;
      }
      seen.add(id);
      walked.push(id);
      if (draft.body !== null) {
        result = id;
        break;
      }
      id = draft.parentSourceId;
    }
    for (const walkedId of walked) {
      resolved.set(walkedId, result);
    }
    return result;
  };

  const kept = [...byId.values()].filter((draft) => draft.body !== null);
  const parentOf = new Map<string, string | null>();
  for (const draft of kept) {
    const parent = resolve(draft.parentSourceId);
    parentOf.set(draft.sourceId, parent === draft.sourceId ? null : parent);
  }
  breakCycles(parentOf);

  const times = orderTimestamps(kept, parentOf, fallbackMs);
  const messages = kept
    .map((draft): ImportedMessage => {
      const { createdAtMs: _createdAtMs, ...body } = draft.body as DraftBody;
      return {
        ...body,
        createdAt: new Date(
          times.get(draft.sourceId) ?? fallbackMs
        ).toISOString(),
        parentSourceId: parentOf.get(draft.sourceId) ?? null,
        sourceId: draft.sourceId,
      };
    })
    // Children are strictly younger than parents, so time order is a topological order.
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0)
    );
  return { messages, resolve };
};

/** Cuts the parent link that closes each cycle, so the nodes form a forest. */
const breakCycles = (parentOf: Map<string, string | null>): void => {
  const settled = new Set<string>();
  for (const start of parentOf.keys()) {
    const chain = new Set<string>();
    let id: string | null = start;
    while (id !== null && !settled.has(id)) {
      if (chain.has(id)) {
        parentOf.set(id, null);
        break;
      }
      chain.add(id);
      id = parentOf.get(id) ?? null;
    }
    for (const member of chain) {
      settled.add(member);
    }
  }
};

/**
 * Each node's time, moved to 1ms after its parent's when it would otherwise
 * sort at or before it. An undated node takes its parent's time (plus 1ms),
 * an undated root `fallbackMs`. Each chain is settled once, top down.
 */
const orderTimestamps = (
  kept: readonly DraftMessage[],
  parentOf: ReadonlyMap<string, string | null>,
  fallbackMs: number
): Map<string, number> => {
  const own = new Map(
    kept.map((draft) => [draft.sourceId, validMs(draft.body?.createdAtMs)])
  );
  const times = new Map<string, number>();
  for (const draft of kept) {
    const chain: string[] = [];
    let id: string | null = draft.sourceId;
    while (id !== null && !times.has(id)) {
      chain.push(id);
      id = parentOf.get(id) ?? null;
    }
    let parentMs = id === null ? undefined : times.get(id);
    for (const member of chain.reverse()) {
      const ownMs = own.get(member) ?? null;
      let ms = ownMs ?? (parentMs === undefined ? fallbackMs : parentMs + 1);
      if (parentMs !== undefined && ms <= parentMs) {
        ms = parentMs + 1;
      }
      times.set(member, ms);
      parentMs = ms;
    }
  }
  return times;
};

const STATUS_RANK: Record<MessageStatus, number> = {
  complete: 0,
  error: 2,
  partial: 1,
};

/**
 * Folds runs of assistant messages into one message: ChatGPT stores a tool
 * turn as separate nodes (call, tool output, answer), while one of our turns
 * is one assistant message with call, result and text parts. A child merges
 * into its assistant parent only when it's that parent's only child, so every
 * branch point stays a message boundary.
 */
export const mergeAssistantChains = (
  messages: readonly ImportedMessage[]
): BuiltTree => {
  const childCount = new Map<string, number>();
  for (const message of messages) {
    if (message.parentSourceId !== null) {
      childCount.set(
        message.parentSourceId,
        (childCount.get(message.parentSourceId) ?? 0) + 1
      );
    }
  }
  // Source id -> the id of the message it was folded into (itself if not folded).
  const headOf = new Map<string, string>();
  const merged = new Map<string, ImportedMessage>();
  for (const message of messages) {
    const parentHead =
      message.parentSourceId === null
        ? null
        : (headOf.get(message.parentSourceId) ?? null);
    const head = parentHead === null ? undefined : merged.get(parentHead);
    if (
      head !== undefined &&
      message.role === "assistant" &&
      head.role === "assistant" &&
      childCount.get(message.parentSourceId ?? "") === 1
    ) {
      merged.set(head.sourceId, {
        ...head,
        model: message.model ?? head.model,
        parts: [...head.parts, ...message.parts],
        status:
          STATUS_RANK[message.status] > STATUS_RANK[head.status]
            ? message.status
            : head.status,
      });
      headOf.set(message.sourceId, head.sourceId);
      continue;
    }
    headOf.set(message.sourceId, message.sourceId);
    merged.set(message.sourceId, { ...message, parentSourceId: parentHead });
  }
  return {
    messages: [...merged.values()],
    resolve: (sourceId) => (sourceId ? (headOf.get(sourceId) ?? null) : null),
  };
};

/**
 * Checks the invariants `persistImport` relies on: unique ids, each parent
 * listed before its children, no child older than its parent. The detail
 * names ids from the export, never content.
 */
export const checkTree = (
  messages: readonly Pick<
    ImportedMessage,
    "createdAt" | "parentSourceId" | "sourceId"
  >[]
): Result<void, string> => {
  const seen = new Map<string, number>();
  for (const message of messages) {
    if (seen.has(message.sourceId)) {
      return err(`duplicate id ${message.sourceId}`);
    }
    const created = Date.parse(message.createdAt);
    if (message.parentSourceId !== null) {
      const parentCreated = seen.get(message.parentSourceId);
      if (parentCreated === undefined) {
        return err(`parent of ${message.sourceId} missing or listed after it`);
      }
      if (created < parentCreated) {
        return err(`${message.sourceId} is older than its parent`);
      }
    }
    seen.set(message.sourceId, created);
  }
  return ok(undefined);
};

/**
 * `nodes` reordered so every parent comes before its children, siblings kept
 * in input order. A node whose parent isn't in `nodes` counts as a root;
 * nodes on a parent cycle (which a stored tree can't have) are dropped.
 */
export const orderParentsFirst = <
  N extends { readonly id: string; readonly parentId: string | null },
>(
  nodes: readonly N[]
): N[] => {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, N[]>();
  for (const node of nodes) {
    const parent =
      node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parent);
    if (siblings) {
      siblings.push(node);
    } else {
      children.set(parent, [node]);
    }
  }
  const ordered: N[] = [];
  // Iterative, so a conversation thousands of turns deep can't overflow the stack.
  const stack = [...(children.get(null) ?? [])].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as N;
    ordered.push(node);
    stack.push(...[...(children.get(node.id) ?? [])].reverse());
  }
  return ordered;
};

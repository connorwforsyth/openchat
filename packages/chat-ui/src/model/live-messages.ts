import {
  fromUIMessage,
  type RecordedDecision,
} from "@workspace/ai/messages/from-ui";
import type {
  ConversationId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import { isToolUIPart, type UIMessage } from "ai";

// While a turn streams, the newest messages exist only in `useChat` (AI SDK
// `UIMessage`s); everything before them is the stored branch. The view shows
// the stored path plus that live tail, mapped to our parts, until the run
// finishes and the refreshed path includes them.

/** Live messages after the last one the stored path already has. */
export const liveTail = (
  pathIds: ReadonlySet<string>,
  live: readonly UIMessage[]
): readonly UIMessage[] => {
  let lastKnown = -1;
  live.forEach((message, index) => {
    if (pathIds.has(message.id)) {
      lastKnown = index;
    }
  });
  return live.slice(lastKnown + 1);
};

/** Decisions on tool calls, by call id, as the server recorded them. */
export type Decisions = ReadonlyMap<string, RecordedDecision>;

const NO_DECISIONS: Decisions = new Map();

/**
 * Who a streamed decision is shown as made by when the viewer isn't given:
 * nobody renders it, and the stored answer carries the real one.
 */
const SOMEONE = "00000000-0000-7000-8000-000000000000" as UserId;

/** Every decided call on a branch: what the server says was decided. Pure. */
export const decisionsOn = (messages: readonly Message[]): Decisions =>
  new Map(
    messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-call" && part.approval.state === "decided"
          ? [
              [
                part.toolCallId,
                {
                  decidedAt: part.approval.decidedAt,
                  decidedBy: part.approval.decidedBy,
                  decision: part.approval.decision,
                },
              ] as const,
            ]
          : []
      )
    )
  );

type LivePart = UIMessage["parts"][number];

/**
 * A live tool part the way the mapper can take it. A call that was
 * answered (the stream said yes or no) but that the stored answer doesn't
 * have a decision for yet is shown decided as the stream says; a stopped
 * call that was never decided shows no approval at all. Both only for
 * display: the stored message replaces them.
 */
const displayable = (
  part: LivePart,
  decisions: Decisions,
  viewer: UserId
): { readonly decision?: RecordedDecision; readonly part: LivePart } => {
  if (!isToolUIPart(part) || part.state === "approval-requested") {
    return { part };
  }
  const { approval } = part;
  if (!approval || approval.isAutomatic || decisions.has(part.toolCallId)) {
    return { part };
  }
  if (typeof approval.approved !== "boolean") {
    return { part: { ...part, approval: undefined } as LivePart };
  }
  return {
    decision: {
      decidedAt: new Date(0).toISOString(),
      decidedBy: viewer,
      decision: approval.approved
        ? { decision: "approve" }
        : {
            decision: "reject",
            ...(approval.reason ? { reason: approval.reason } : {}),
          },
    },
    part,
  };
};

/**
 * A streaming message's parts in our schema, for display. The stream
 * carries a decision only as yes or no, so the stored answer's decisions
 * (`decisions`) come first, and a call the server already has a decision
 * for shows decided even while the stream still says it waits: the card
 * goes when the server has the decision, however the page learns it. A
 * part that still can't be mapped is dropped on its own, never the rest
 * of the message (072: every card after the first decision vanished).
 */
export const liveParts = (
  message: Pick<UIMessage, "parts">,
  decisions: Decisions = NO_DECISIONS,
  viewer: UserId = SOMEONE
): MessagePart[] => {
  const prepared = message.parts.map((part) =>
    displayable(part, decisions, viewer)
  );
  const streamed = new Map(
    prepared.flatMap(({ decision, part }) =>
      decision && isToolUIPart(part)
        ? [[part.toolCallId, decision] as const]
        : []
    )
  );
  const options = {
    decisionFor: (toolCallId: string) =>
      decisions.get(toolCallId) ?? streamed.get(toolCallId),
    now: () => new Date(),
  };
  const parts = prepared.map(({ part }) => part);
  const mapped = fromUIMessage({ parts }, options);
  const each = mapped.ok
    ? mapped.value
    : parts.flatMap((part) => {
        const one = fromUIMessage({ parts: [part] }, options);
        return one.ok ? one.value : [];
      });
  return each.map((part) => {
    const decided =
      part.type === "tool-call" && part.approval.state === "pending"
        ? decisions.get(part.toolCallId)
        : undefined;
    return decided && part.type === "tool-call"
      ? {
          ...part,
          approval: {
            decidedAt:
              typeof decided.decidedAt === "string"
                ? decided.decidedAt
                : decided.decidedAt.toISOString(),
            decidedBy: decided.decidedBy,
            decision: decided.decision,
            state: "decided",
          },
        }
      : part;
  });
};

/** A live `UIMessage` as a `Message` the conversation view can render. */
export const liveMessage = (
  message: UIMessage,
  context: {
    readonly authorId: UserId;
    readonly conversationId: ConversationId;
    readonly createdAt: string;
    /** The stored branch's decisions (`decisionsOn`). */
    readonly decisions?: Decisions;
    readonly parentId: MessageId | null;
  }
): Message => ({
  agent: null,
  authorId: message.role === "user" ? context.authorId : null,
  conversationId: context.conversationId,
  createdAt: context.createdAt,
  id: message.id as MessageId,
  model: null,
  parentId: context.parentId,
  parts: liveParts(message, context.decisions, context.authorId),
  partsVersion: 1,
  role: message.role,
  runId: null,
  status: "complete",
  usage: null,
});

const callIds = (message: Pick<Message, "parts">): Set<string> =>
  new Set(
    message.parts.flatMap((part) =>
      part.type === "tool-call" ? [part.toolCallId] : []
    )
  );

/** Whether the live copy of an answer has every call the stored one has. */
const caughtUp = (live: Message, stored: Message): boolean => {
  const shown = callIds(live);
  return [...callIds(stored)].every((id) => shown.has(id));
};

/** A live message's mapping, and the decisions it was mapped with. */
export interface LiveMapping {
  readonly decided: string;
  readonly message: Message;
}

/**
 * The stored path followed by the live tail, parents chained. `cache` keeps
 * a live message's mapping while its `UIMessage` is unchanged, so rows stay
 * memoised and a token re-renders only the message it landed in (D28).
 *
 * The run stores its assistant message when it starts (040's e2e: the path
 * refetched after sending already has it, empty and `partial`), so the
 * message that is streaming (`streamingId`) shows its live version in place
 * of the stored one until the run finishes and the path catches up.
 */
export const mergeLive = (
  path: readonly Message[],
  live: readonly UIMessage[],
  context: {
    readonly authorId: UserId;
    readonly conversationId: ConversationId;
    readonly now: string;
  },
  cache?: WeakMap<UIMessage, LiveMapping>,
  streamingId: string | null = null
): readonly Message[] => {
  const decisions = decisionsOn(path);
  // A decision the server recorded changes how a live call shows, so the
  // cached mapping is only good for the decisions it was made with.
  const decided = [...decisions.keys()].sort().join(" ");
  const mapLive = (message: UIMessage, parentId: MessageId | null) => {
    const cached = cache?.get(message);
    const mapped =
      cached &&
      cached.message.parentId === parentId &&
      cached.decided === decided
        ? cached.message
        : liveMessage(message, {
            authorId: context.authorId,
            conversationId: context.conversationId,
            createdAt: context.now,
            decisions,
            parentId,
          });
    cache?.set(message, { decided, message: mapped });
    return mapped;
  };
  const streaming = streamingId
    ? live.find((message) => message.id === streamingId)
    : undefined;
  const stored = streaming
    ? path.map((message) => {
        if (message.id !== streaming.id) {
          return message;
        }
        const mapped = mapLive(streaming, message.parentId);
        // A page that picks a run up replays its stream from the start, so
        // for a moment the live copy has fewer calls than the stored one:
        // showing it would unmount a card and bring it straight back.
        // Who answers is the stored copy's: the stream doesn't say, and the
        // switch marker (107) reads it.
        return caughtUp(mapped, message)
          ? {
              ...mapped,
              agent: message.agent,
              createdAt: message.createdAt,
              model: message.model,
              runId: message.runId,
            }
          : message;
      })
    : path;
  const tail = liveTail(new Set(path.map((message) => message.id)), live);
  if (tail.length === 0) {
    return streaming ? stored : path;
  }
  const merged: Message[] = [...stored];
  for (const message of tail) {
    merged.push(mapLive(message, merged.at(-1)?.id ?? null));
  }
  return merged;
};

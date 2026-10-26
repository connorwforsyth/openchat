import type {
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Run, TurnDelivery } from "@workspace/contract/schemas/runs";

// The turns waiting on an answer being written (D25's branch queue), as the
// composer's queue shows them. The server keeps the queue, so a reload and
// a second tab show the same one: each item is a queued run and the user
// message it will answer. While it waits, that message shows in the queue,
// not the transcript; it joins the transcript when its run starts, or where
// the answer took it as a steer.

export interface QueuedTurn {
  readonly delivery: TurnDelivery;
  readonly messageId: MessageId;
  /** Whether the viewer sent it: only its author may steer, edit or remove it. */
  readonly mine: boolean;
  /** 1 is next. */
  readonly position: number;
  readonly runId: RunId;
  /** What it says, once the page has the message. */
  readonly text: string | null;
}

const textOf = (message: Message | undefined): string | null =>
  message
    ? message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
    : null;

/** The queued turns, next first, with their text where `messages` has it. Pure. */
export const queuedTurns = (
  runs: readonly Run[] | undefined,
  messages: readonly Message[],
  viewer: UserId
): readonly QueuedTurn[] => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return (runs ?? [])
    .flatMap((run): QueuedTurn[] =>
      run.state.status === "queued"
        ? [
            {
              delivery: run.options?.delivery ?? "queue",
              messageId: run.userMessageId,
              mine: run.createdBy === viewer,
              position: run.state.position,
              runId: run.id,
              text: textOf(byId.get(run.userMessageId)),
            },
          ]
        : []
    )
    .sort((a, b) => a.position - b.position);
};

/** The branch as the transcript shows it: without messages still queued. Pure. */
export const withoutQueued = (
  messages: readonly Message[],
  queued: readonly QueuedTurn[]
): readonly Message[] => {
  if (queued.length === 0) {
    return messages;
  }
  const waiting = new Set<string>(queued.map((turn) => turn.messageId));
  return messages.filter((message) => !waiting.has(message.id));
};

/** Why an action on a queued turn didn't happen, for the person to read. */
export type QueueFailure = "failed" | "finished" | "forbidden";

/** The failure an API error stands for. Pure. */
export const queueFailureOf = (error: unknown): QueueFailure => {
  const code =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown }).code
      : undefined;
  switch (code) {
    case "FORBIDDEN":
      return "forbidden";
    case "CONFLICT":
    case "NOT_FOUND":
      return "finished";
    default:
      return "failed";
  }
};

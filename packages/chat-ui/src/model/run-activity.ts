import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";

// Where a conversation's runs stand, from `runs.list({ active: true })`,
// for the states the chat shows (072): which answers are still being
// written or wait on a decision, which run Stop stops, and whether the only
// thing going on is a change waiting for the person. Pure.

/** How an unfinished answer's run is doing. */
export type AnswerPhase = "queued" | "running" | "waiting";

const phaseOf = (run: Run): AnswerPhase | null => {
  switch (run.state.status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "awaiting_approval":
      return "waiting";
    default:
      return null;
  }
};

/** Unfinished answers, by their message id. */
export const answerPhases = (
  runs: readonly Run[] | undefined
): ReadonlyMap<string, AnswerPhase> =>
  new Map(
    (runs ?? []).flatMap((run) => {
      const phase = phaseOf(run);
      return phase && run.assistantMessageId
        ? [[run.assistantMessageId, phase] as const]
        : [];
    })
  );

/**
 * The run Stop stops: the one answering (running or waiting on a
 * decision), not one queued behind it. Newest first, like the list.
 */
export const stoppableRun = (runs: readonly Run[] | undefined): Run | null =>
  runs?.find(
    (run) =>
      run.state.status === "running" || run.state.status === "awaiting_approval"
  ) ?? null;

/**
 * The run a page opened mid-answer follows: `undefined` until the list
 * loads, `null` when nothing is going. A run waiting on a decision counts:
 * its stream stays open and carries the answer on once someone decides.
 */
export const runToFollow = (
  runs: readonly Run[] | undefined
): string | null | undefined =>
  runs ? (runs.find((run) => phaseOf(run) !== null)?.id ?? null) : undefined;

/** Tool calls on screen still waiting for a decision. */
export const waitingCalls = (messages: readonly Message[]): string[] =>
  messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool-call" && part.approval.state === "pending"
        ? [part.toolCallId]
        : []
    )
  );

/**
 * Whether the only thing going on is a change waiting for the person: a run
 * waits, a card is on screen, and no decision is on its way. The composer
 * then sends (a new message moves on from the waiting answer) instead of
 * offering only Stop.
 */
export const waitingForPerson = ({
  pending,
  runs,
  sending,
}: {
  /** Calls on screen waiting for a decision. */
  readonly pending: readonly string[];
  readonly runs: readonly Run[] | undefined;
  /** Calls whose decision this page is sending. */
  readonly sending: ReadonlySet<string>;
}): boolean =>
  stoppableRun(runs)?.state.status === "awaiting_approval" &&
  pending.length > 0 &&
  pending.every((id) => !sending.has(id));

/**
 * Calls the waiting run asks about that the screen doesn't show at all: a
 * restored or stale copy of the answer (072, audit F2), so it's refetched.
 */
export const unseenApprovals = (
  runs: readonly Run[] | undefined,
  messages: readonly Message[]
): string[] => {
  const shown = new Set(
    messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-call" ? [part.toolCallId] : []
      )
    )
  );
  return (runs ?? []).flatMap((run) =>
    run.state.status === "awaiting_approval"
      ? run.state.approvals.flatMap((approval) =>
          shown.has(approval.toolCallId) ? [] : [approval.toolCallId]
        )
      : []
  );
};

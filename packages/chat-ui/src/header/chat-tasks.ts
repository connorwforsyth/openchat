import type { MessageId, RunId } from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";

import { messageText, type ToolCallPart } from "../model/parts";
import type { QueuedTurn } from "../model/queue";

// What the agent is working on in this chat, for the Tasks list on the
// outputs card (night 2, decision 4): the answer being written, then the
// turns waiting behind it, next first. Built from the active runs and the
// composer's queue, so a reload and a second tab list the same. Pure.

export type TaskStatus = "queued" | "running" | "steering" | "waiting";

export interface ChatTask {
  /** Where the turn shows: its answer, else the message it answers. */
  readonly messageId: MessageId;
  readonly runId: RunId;
  readonly status: TaskStatus;
  /** The tool call the answer is on, while it runs one. */
  readonly step: ToolCallPart | null;
  /** What was asked, once the page has the message. */
  readonly text: string | null;
}

/** The tool call an answer is on: its last one with no result yet. */
const currentStep = (answer: Message | undefined): ToolCallPart | null => {
  if (!answer) {
    return null;
  }
  const done = new Set(
    answer.parts.flatMap((part) =>
      part.type === "tool-result" ? [part.toolCallId] : []
    )
  );
  return (
    answer.parts
      .filter(
        (part): part is ToolCallPart =>
          part.type === "tool-call" && !done.has(part.toolCallId)
      )
      .at(-1) ?? null
  );
};

const answeringStatus = (run: Run): TaskStatus | null => {
  switch (run.state.status) {
    case "running":
      return "running";
    case "awaiting_approval":
      return "waiting";
    default:
      return null;
  }
};

export const chatTasks = (
  runs: readonly Run[] | undefined,
  queued: readonly QueuedTurn[],
  messages: readonly Message[]
): readonly ChatTask[] => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const answering = (runs ?? []).flatMap((run): ChatTask[] => {
    const status = answeringStatus(run);
    if (status === null) {
      return [];
    }
    const asked = byId.get(run.userMessageId);
    const answer = run.assistantMessageId
      ? byId.get(run.assistantMessageId)
      : undefined;
    return [
      {
        messageId: answer?.id ?? run.userMessageId,
        runId: run.id,
        status,
        step: status === "running" ? currentStep(answer) : null,
        text: asked ? messageText(asked) : null,
      },
    ];
  });
  return [
    ...answering,
    ...queued.map(
      (turn): ChatTask => ({
        messageId: turn.messageId,
        runId: turn.runId,
        status: turn.delivery === "steer" ? "steering" : "queued",
        step: null,
        text: turn.text,
      })
    ),
  ];
};

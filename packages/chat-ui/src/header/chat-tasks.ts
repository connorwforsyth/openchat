import type { MessageId, RunId } from "@workspace/contract/schemas/common";
import {
  type ArtifactKind,
  artifactKindSchema,
} from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";
import { z } from "zod";

import { messageText, type ToolCallPart } from "../model/parts";

// What the agent is working on in this chat, for the Tasks list on the
// outputs card (night 2, decision 4): the answer being written, then the
// turns waiting behind it, next first. Built from the active runs and the
// thread (a message sent while the agent works is in it at once), so a
// reload and a second tab list the same. Pure.

const CREATE_ARTIFACT = "create_artifact";

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
    case "queued":
    case "succeeded":
    case "failed":
    case "cancelled":
      return null;
    default:
      return run.state satisfies never;
  }
};

/** A turn waiting its turn: a steer waits for the next step boundary. */
const queuedTask = (run: Run, byId: ReadonlyMap<string, Message>): ChatTask => {
  const asked = byId.get(run.userMessageId);
  return {
    messageId: run.userMessageId,
    runId: run.id,
    status: run.options?.delivery === "steer" ? "steering" : "queued",
    step: null,
    text: asked ? messageText(asked) : null,
  };
};

const positionOf = (run: Run): number =>
  run.state.status === "queued" ? run.state.position : 0;

export const chatTasks = (
  runs: readonly Run[] | undefined,
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
  const queued = (runs ?? [])
    .filter((run) => run.state.status === "queued")
    .sort((a, b) => positionOf(a) - positionOf(b))
    .map((run) => queuedTask(run, byId));
  return [...answering, ...queued];
};

const makingInputSchema = z.object({
  title: z.string().min(1),
  type: artifactKindSchema,
});

export interface ArtifactInMaking {
  readonly kind: ArtifactKind;
  readonly runId: RunId;
  readonly title: string;
}

/**
 * Artifacts a running answer is creating: its `create_artifact` call, until
 * it has a result. The artifact itself only exists once it's saved, with
 * its first version, so this is the one place "Making…" can come from.
 */
export const artifactsInMaking = (
  tasks: readonly ChatTask[]
): readonly ArtifactInMaking[] =>
  tasks.flatMap((task) => {
    if (task.step?.toolName !== CREATE_ARTIFACT) {
      return [];
    }
    const input = makingInputSchema.safeParse(task.step.input);
    return input.success
      ? [{ kind: input.data.type, runId: task.runId, title: input.data.title }]
      : [];
  });

import {
  REPORT_TOOL,
  reportInputSchema,
  SCHEDULED_TASK_DATA,
  scheduledTaskDataSchema,
} from "@workspace/ai/schedules/tool";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { z } from "zod";

// Scheduled runs in the transcript (173, 175). A schedule's message carries
// a `scheduled-task` data part ("Sent by scheduled task"), and its answer
// ends with a `report_outcome` call. A quiet run (`no_update`) has nothing
// to say, so the pair folds into one muted line. Pure.

export type ScheduledTask = z.infer<typeof scheduledTaskDataSchema>;
export type RunReport = z.infer<typeof reportInputSchema>;

/** The schedule a user message was sent by, if one sent it. */
export const scheduledTaskOf = (
  parts: readonly MessagePart[]
): ScheduledTask | null => {
  for (const part of parts) {
    if (part.type === "data" && part.name === SCHEDULED_TASK_DATA) {
      const parsed = scheduledTaskDataSchema.safeParse(part.data);
      return parsed.success ? parsed.data : null;
    }
  }
  return null;
};

/** What an answer's `report_outcome` call said, if it made one. */
export const reportOf = (parts: readonly MessagePart[]): RunReport | null => {
  for (const part of [...parts].reverse()) {
    if (part.type === "tool-call" && part.toolName === REPORT_TOOL) {
      const parsed = reportInputSchema.safeParse(part.input);
      return parsed.success ? parsed.data : null;
    }
  }
  return null;
};

const hasText = (parts: readonly MessagePart[]) =>
  parts.some((part) => part.type === "text" && part.text.trim() !== "");

/**
 * The ids of messages that fold away: each scheduled message whose answer
 * (the next message, its child) reported `no_update` with nothing to say.
 * Maps the user message's id to its answer's.
 */
export const quietRuns = (
  messages: readonly {
    readonly id: string;
    readonly parentId: string | null;
    readonly parts: readonly MessagePart[];
    readonly role: Message["role"];
  }[]
): ReadonlyMap<string, string> => {
  const quiet = new Map<string, string>();
  messages.forEach((message, index) => {
    const answer = messages[index + 1];
    if (
      message.role === "user" &&
      answer?.role === "assistant" &&
      answer.parentId === message.id &&
      scheduledTaskOf(message.parts) &&
      reportOf(answer.parts)?.outcome === "no_update" &&
      !hasText(answer.parts)
    ) {
      quiet.set(message.id, answer.id);
    }
  });
  return quiet;
};

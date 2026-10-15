import { z } from "zod";

import {
  conversationIdSchema,
  dotIdSchema,
  dotScheduleIdSchema,
  nameSchema,
  runIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { toolNameSchema } from "./message-parts";
import { runStatusSchema, runTargetSchema } from "./runs";
import { sandboxProviderSchema } from "./sandbox";

// Dots (172): persistent, always-on agents. A Dot is an agent (or a model
// plus instructions) with its own conversation, workspace and schedules. Each
// scheduled or manual run posts a user message with the schedule's prompt into
// the Dot's conversation and answers it; the owner sees unread results.

/**
 * A standard five-field cron expression (`minute hour day month weekday`),
 * evaluated in the schedule's time zone. The server rejects one it can't
 * parse with `BAD_REQUEST`.
 */
export const cronExpressionSchema = z.string().trim().min(9).max(120);

/** An IANA time zone (`Europe/London`); the server rejects unknown ones. */
export const timeZoneSchema = z.string().trim().min(1).max(64);

/** The prompt a scheduled run posts as the user message. */
export const dotPromptSchema = z.string().trim().min(1).max(10_000);

export const dotScheduleSchema = z.object({
  createdAt: timestampSchema,
  cron: cronExpressionSchema,
  dotId: dotIdSchema,
  enabled: z.boolean(),
  id: dotScheduleIdSchema,
  /** When it last fired; `null` before the first time. */
  lastRunAt: timestampSchema.nullable(),
  /** How the last fired run ended; `null` before the first time. */
  lastStatus: runStatusSchema.nullable(),
  /** The next time it fires; `null` while it or its Dot is disabled. */
  nextRunAt: timestampSchema.nullable(),
  prompt: dotPromptSchema,
  timezone: timeZoneSchema,
  updatedAt: timestampSchema,
});
export type DotSchedule = z.infer<typeof dotScheduleSchema>;

export const dotRunTriggerSchema = z.enum(["schedule", "manual"]);
export type DotRunTrigger = z.infer<typeof dotRunTriggerSchema>;

/** The Dot's most recent run, scheduled or manual. */
export const dotLastRunSchema = z.object({
  /** Why it failed, when it did. */
  error: z.string().max(2000).nullable(),
  finishedAt: timestampSchema.nullable(),
  runId: runIdSchema,
  scheduleId: dotScheduleIdSchema.nullable(),
  /** The start of the reply's text, for the list; `null` until there is one. */
  snippet: z.string().max(500).nullable(),
  startedAt: timestampSchema,
  status: runStatusSchema,
  trigger: dotRunTriggerSchema,
});
export type DotLastRun = z.infer<typeof dotLastRunSchema>;

/** The pill in the list: nothing happening, a run in flight, or the last run failed. */
export const dotStatusSchema = z.enum(["idle", "running", "failed"]);
export type DotStatus = z.infer<typeof dotStatusSchema>;

export const dotSchema = z.object({
  /**
   * Tools the Dot may run unattended even where its agent says `ask`. Any
   * other `ask` tool is refused with a tool error on a scheduled or manual
   * run: nobody is there to approve it, and a Dot's run never waits.
   */
  autoApproveTools: z.array(toolNameSchema).max(100),
  /** The Dot's own conversation; every run posts into it. */
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  enabled: z.boolean(),
  id: dotIdSchema,
  /** Added to every run's prompt; on top of an agent's own instructions. */
  instructions: z.string().max(20_000),
  lastRun: dotLastRunSchema.nullable(),
  name: nameSchema,
  /** The soonest `nextRunAt` of its enabled schedules. */
  nextRunAt: timestampSchema.nullable(),
  ownerId: userIdSchema,
  /** The workspace provider; `null` means the instance default. */
  sandboxProvider: sandboxProviderSchema.nullable(),
  schedules: z.array(dotScheduleSchema),
  status: dotStatusSchema,
  /** The agent, or the model, that answers each run. */
  target: runTargetSchema,
  /** A run finished after the owner last opened the Dot. */
  unread: z.boolean(),
  updatedAt: timestampSchema,
});
export type Dot = z.infer<typeof dotSchema>;

export const dotScheduleInputSchema = z.object({
  cron: cronExpressionSchema,
  enabled: z.boolean().default(true),
  prompt: dotPromptSchema,
  timezone: timeZoneSchema.default("UTC"),
});
export type DotScheduleInput = z.infer<typeof dotScheduleInputSchema>;

export const createDotInputSchema = z.object({
  autoApproveTools: z.array(toolNameSchema).max(100).default([]),
  enabled: z.boolean().default(true),
  instructions: z.string().max(20_000).default(""),
  name: nameSchema,
  sandboxProvider: sandboxProviderSchema.nullable().default(null),
  schedules: z.array(dotScheduleInputSchema).max(10).default([]),
  target: runTargetSchema,
});
export type CreateDotInput = z.infer<typeof createDotInputSchema>;

export const updateDotInputSchema = z.object({
  autoApproveTools: z.array(toolNameSchema).max(100).optional(),
  enabled: z.boolean().optional(),
  id: dotIdSchema,
  instructions: z.string().max(20_000).optional(),
  name: nameSchema.optional(),
  sandboxProvider: sandboxProviderSchema.nullable().optional(),
  target: runTargetSchema.optional(),
});
export type UpdateDotInput = z.infer<typeof updateDotInputSchema>;

export const createDotScheduleInputSchema = dotScheduleInputSchema.extend({
  dotId: dotIdSchema,
});
export type CreateDotScheduleInput = z.infer<
  typeof createDotScheduleInputSchema
>;

export const updateDotScheduleInputSchema = z.object({
  cron: cronExpressionSchema.optional(),
  enabled: z.boolean().optional(),
  id: dotScheduleIdSchema,
  prompt: dotPromptSchema.optional(),
  timezone: timeZoneSchema.optional(),
});
export type UpdateDotScheduleInput = z.infer<
  typeof updateDotScheduleInputSchema
>;

export const runDotNowInputSchema = z.object({
  id: dotIdSchema,
  /** Omitted means the first schedule's prompt, or a generic check-in. */
  prompt: dotPromptSchema.optional(),
});
export type RunDotNowInput = z.infer<typeof runDotNowInputSchema>;

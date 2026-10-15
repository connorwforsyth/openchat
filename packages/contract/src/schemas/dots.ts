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

/** A run a Dot started, for its Activity tab (and its latest run). */
export const dotActivitySchema = dotLastRunSchema;
export type DotActivity = z.infer<typeof dotActivitySchema>;

/**
 * The shape of a Dot's animated avatar. Each is drawn from CSS (only
 * transform and opacity animate) and coloured with `color`.
 */
export const dotAvatarStyleSchema = z.enum([
  "orb",
  "blob",
  "ring",
  "spark",
  "pebble",
]);
export type DotAvatarStyle = z.infer<typeof dotAvatarStyleSchema>;

/** A theme colour token (`--dot-<name>`), never a literal colour. */
export const dotAvatarColorSchema = z.enum([
  "ember",
  "sun",
  "moss",
  "sea",
  "dusk",
  "bloom",
]);
export type DotAvatarColor = z.infer<typeof dotAvatarColorSchema>;

export const dotAvatarSchema = z.object({
  color: dotAvatarColorSchema,
  style: dotAvatarStyleSchema,
});
export type DotAvatar = z.infer<typeof dotAvatarSchema>;

/**
 * How you `@`-mention the Dot: 2–24 lowercase letters, digits, `-` or `_`,
 * unique among the owner's Dots. Shown with the `@`; stored without it.
 */
export const dotHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{1,23}$/);

/** A Dot's name: short, like a nickname. */
export const dotNameSchema = z.string().trim().min(1).max(24);

/** The owner's own words on when it may act and when it must ask. */
export const dotRulesSchema = z.string().max(4000);

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
  avatar: dotAvatarSchema,
  /** The Dot's own conversation; every run posts into it. */
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  enabled: z.boolean(),
  /** Without the `@`. */
  handle: dotHandleSchema,
  id: dotIdSchema,
  /** Added to every run's prompt; on top of an agent's own instructions. */
  instructions: z.string().max(20_000),
  lastRun: dotLastRunSchema.nullable(),
  /** When the owner last opened it; `null` before the first time. */
  lastViewedAt: timestampSchema.nullable(),
  name: nameSchema,
  /** The soonest `nextRunAt` of its enabled schedules. */
  nextRunAt: timestampSchema.nullable(),
  ownerId: userIdSchema,
  /**
   * The owner's one primary Dot: first in the sidebar, where a new message
   * to "your Dot" goes. Exactly one of the owner's Dots is primary.
   */
  primary: z.boolean(),
  /** When it may act on its own and when it should ask; see `dotRulesSchema`. */
  rules: dotRulesSchema,
  /** The workspace provider; `null` means the instance default. */
  sandboxProvider: sandboxProviderSchema.nullable(),
  schedules: z.array(dotScheduleSchema),
  status: dotStatusSchema,
  /** The agent, or the model, that answers each run. */
  target: runTargetSchema,
  /** A run finished after the owner last opened the Dot. */
  unread: z.boolean(),
  /** How many of its runs finished since the owner last opened it. */
  unreadRuns: z.number().int().min(0),
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
  avatar: dotAvatarSchema.default({ color: "sea", style: "orb" }),
  enabled: z.boolean().default(true),
  /** Omitted, the server derives one from the name (made unique). */
  handle: dotHandleSchema.optional(),
  instructions: z.string().max(20_000).default(""),
  name: dotNameSchema,
  /** Make it the primary Dot. The owner's first Dot is primary anyway. */
  primary: z.boolean().default(false),
  rules: dotRulesSchema.default(""),
  sandboxProvider: sandboxProviderSchema.nullable().default(null),
  schedules: z.array(dotScheduleInputSchema).max(10).default([]),
  target: runTargetSchema,
});
export type CreateDotInput = z.infer<typeof createDotInputSchema>;

export const updateDotInputSchema = z.object({
  autoApproveTools: z.array(toolNameSchema).max(100).optional(),
  avatar: dotAvatarSchema.optional(),
  enabled: z.boolean().optional(),
  handle: dotHandleSchema.optional(),
  id: dotIdSchema,
  instructions: z.string().max(20_000).optional(),
  name: dotNameSchema.optional(),
  /** `true` makes it the primary Dot (the previous one stops being). */
  primary: z.literal(true).optional(),
  rules: dotRulesSchema.optional(),
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

export const dotActivityInputSchema = z.object({
  id: dotIdSchema,
  limit: z.number().int().min(1).max(100).default(30),
});
export type DotActivityInput = z.infer<typeof dotActivityInputSchema>;

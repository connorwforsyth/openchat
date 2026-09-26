import { z } from "zod";

import {
  conversationIdSchema,
  decisionIdSchema,
  jsonValueSchema,
  pageInputSchema,
  runIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { modelRefSchema } from "./models";

// The Decider (D15): fast, typed yes/no, choice and score answers with
// probabilities. It can only make a permission path stricter, never override
// a rule. Every decision is logged to `decision_log`. The port itself is in
// `@workspace/ai/ports/decider`; these are the data shapes it and the log share.

const questionIdSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]{0,63}$/, "a camelCase or snake_case id");

export const deciderQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    id: questionIdSchema,
    prompt: z.string().min(1),
    type: z.literal("boolean"),
  }),
  z.object({
    id: questionIdSchema,
    options: z
      .array(
        z.object({
          description: z.string().max(500).optional(),
          id: questionIdSchema,
        })
      )
      .min(2)
      .max(50),
    prompt: z.string().min(1),
    type: z.literal("choice"),
  }),
  z.object({
    id: questionIdSchema,
    prompt: z.string().min(1),
    /** What 0 and 1 mean. */
    rubric: z.string().max(2000).optional(),
    type: z.literal("score"),
  }),
]);
export type DeciderQuestion = z.infer<typeof deciderQuestionSchema>;

const probabilitySchema = z.number().min(0).max(1);

/** `probability` is the Decider's confidence in `value`, calibrated where the adapter supports it. */
export const deciderAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    id: questionIdSchema,
    probability: probabilitySchema,
    type: z.literal("boolean"),
    value: z.boolean(),
  }),
  z.object({
    /** Probability of each option; sums to about 1. */
    distribution: z.record(z.string(), probabilitySchema),
    id: questionIdSchema,
    probability: probabilitySchema,
    type: z.literal("choice"),
    value: questionIdSchema,
  }),
  z.object({
    id: questionIdSchema,
    probability: probabilitySchema,
    type: z.literal("score"),
    value: probabilitySchema,
  }),
]);
export type DeciderAnswer = z.infer<typeof deciderAnswerSchema>;

/** What the Decider looks at: the turn's text, a little history, and named facts. */
export const deciderStateSchema = z.object({
  facts: z.record(z.string(), jsonValueSchema).default({}),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(20_000),
      })
    )
    .max(50)
    .default([]),
  input: z.string().max(100_000),
});
export type DeciderState = z.infer<typeof deciderStateSchema>;

export const deciderAdapterSchema = z.enum(["llm-fallback", "jev", "rules"]);

/** Where the decision plugged in (D15's list). */
export const deciderPurposeSchema = z.enum([
  "auto-route",
  "retrieval-gate",
  "risk-score",
  "context-select",
  "addressed-to-ai",
  "intent",
  "moderation",
  "quality-score",
]);
export type DeciderPurpose = z.infer<typeof deciderPurposeSchema>;

export const decisionLogEntrySchema = z.object({
  adapter: deciderAdapterSchema,
  /** `null` when the adapter failed and the caller fell back to its default. */
  answer: deciderAnswerSchema.nullable(),
  conversationId: conversationIdSchema.nullable(),
  createdAt: timestampSchema,
  error: z.string().nullable(),
  id: decisionIdSchema,
  latencyMs: z.int().min(0),
  model: modelRefSchema.nullable(),
  purpose: deciderPurposeSchema,
  question: deciderQuestionSchema,
  runId: runIdSchema.nullable(),
  userId: userIdSchema.nullable(),
});
export type DecisionLogEntry = z.infer<typeof decisionLogEntrySchema>;

export const listDecisionsInputSchema = pageInputSchema.extend({
  conversationId: conversationIdSchema.optional(),
  purpose: deciderPurposeSchema.optional(),
  runId: runIdSchema.optional(),
});

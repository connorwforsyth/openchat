import { z } from "zod";

import {
  budgetIdSchema,
  microUsdSchema,
  orgIdSchema,
  pageInputSchema,
  providerKeyIdSchema,
  runIdSchema,
  teamIdSchema,
  timestampSchema,
  transactionIdSchema,
  userIdSchema,
} from "./common";
import { keyScopeSchema } from "./keys";
import { modelRefSchema, tokenUsageSchema } from "./models";
import { chatContextSchema, principalSchema } from "./tenancy";

// Usage and budgets (D17, D24). Every model call is a transaction recorded
// against both the user and the chat context; team spend rolls up to parent
// teams and the org. Budgets are checked before a run is created.

export const usageKindSchema = z.enum([
  "chat",
  "embedding",
  "decider",
  "title",
  "tool",
]);

export const transactionSchema = z.object({
  context: chatContextSchema,
  costMicros: microUsdSchema,
  createdAt: timestampSchema,
  id: transactionIdSchema,
  kind: usageKindSchema,
  model: modelRefSchema,
  /** Whose key paid. */
  paidBy: keyScopeSchema,
  runId: runIdSchema.nullable(),
  usage: tokenUsageSchema,
  userId: userIdSchema,
});
export type Transaction = z.infer<typeof transactionSchema>;

/** A principal named flat, so it fits a query string. */
const principalQuery = {
  principalId: z.union([userIdSchema, teamIdSchema, orgIdSchema]),
  principalType: z.enum(["user", "team", "org"]),
};

export const usageGroupBySchema = z.enum([
  "model",
  "user",
  "day",
  "kind",
  "conversation",
  "key",
]);

export const usageSummaryInputSchema = z
  .object({
    ...principalQuery,
    from: timestampSchema,
    groupBy: usageGroupBySchema.default("model"),
    /** Only usage paid with this stored key. */
    keyId: providerKeyIdSchema.optional(),
    /** Only usage in this space and the spaces below it; give both or neither. */
    spaceId: z.union([orgIdSchema, teamIdSchema]).optional(),
    spaceType: z.enum(["org", "team"]).optional(),
    to: timestampSchema,
  })
  .refine(
    (input) =>
      (input.spaceId === undefined) === (input.spaceType === undefined),
    {
      message: "`spaceId` and `spaceType` go together.",
      path: ["spaceId"],
    }
  );

export const usageSummarySchema = z.object({
  from: timestampSchema,
  principal: principalSchema,
  rows: z.array(
    z.object({
      costMicros: microUsdSchema,
      /**
       * The group's key: a model ref, user id, ISO date, usage kind,
       * conversation id or provider key id. `""` groups usage outside any
       * chat, or paid by the instance's keys.
       */
      key: z.string(),
      /** A readable name for the key, when it has one: a chat's title, a person's or a key's name. */
      label: z.string().optional(),
      /**
       * The person's page in the trace viewer (Langfuse), for instance
       * admins, when the instance names one. `user` groups only.
       */
      traceUrl: z.url().optional(),
      usage: tokenUsageSchema,
    })
  ),
  to: timestampSchema,
  totalCostMicros: microUsdSchema,
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const listTransactionsInputSchema = pageInputSchema.extend({
  ...principalQuery,
});

export const budgetPeriodSchema = z.enum(["day", "week", "month"]);

export const budgetSchema = z.object({
  /** Block new runs when spent (`true`), or only warn. */
  hard: z.boolean(),
  id: budgetIdSchema,
  limitMicros: microUsdSchema,
  period: budgetPeriodSchema,
  principal: principalSchema,
  resetsAt: timestampSchema,
  usedMicros: microUsdSchema,
});
export type Budget = z.infer<typeof budgetSchema>;

/**
 * One budget per org, principal and period; setting it again replaces it.
 * `orgId` is the org the budget applies in: a user's budget caps their spend
 * in that org's contexts, so an org admin can cap one member there. Omitted,
 * it's the principal's own org (a user's personal org), as before 042; it
 * becomes required in the next contract release.
 */
export const setBudgetInputSchema = z.object({
  hard: z.boolean().default(true),
  limitMicros: microUsdSchema,
  orgId: orgIdSchema.optional(),
  period: budgetPeriodSchema,
  principal: principalSchema,
});

export const listBudgetsInputSchema = z.object({
  orgId: orgIdSchema,
});

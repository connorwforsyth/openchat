import { z } from "zod";

import {
  budgetIdSchema,
  microUsdSchema,
  orgIdSchema,
  pageInputSchema,
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

export const usageSummaryInputSchema = z.object({
  ...principalQuery,
  from: timestampSchema,
  groupBy: z.enum(["model", "user", "day", "kind"]).default("model"),
  to: timestampSchema,
});

export const usageSummarySchema = z.object({
  from: timestampSchema,
  principal: principalSchema,
  rows: z.array(
    z.object({
      costMicros: microUsdSchema,
      /** The group's key: a model ref, user id, ISO date or usage kind. */
      key: z.string(),
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

/** One budget per principal and period; setting it again replaces it. */
export const setBudgetInputSchema = z.object({
  hard: z.boolean().default(true),
  limitMicros: microUsdSchema,
  period: budgetPeriodSchema,
  principal: principalSchema,
});

export const listBudgetsInputSchema = z.object({
  orgId: orgIdSchema,
});

import { z } from "zod";

import { conflictError, featureError } from "../errors";
import {
  budgetIdSchema,
  conversationIdSchema,
  pageOf,
  sandboxIdSchema,
} from "../schemas/common";
import {
  decisionLogEntrySchema,
  listDecisionsInputSchema,
} from "../schemas/decider";
import {
  execInputSchema,
  execResultSchema,
  fileEntrySchema,
  sandboxPathSchema,
  sandboxPreviewSchema,
  sandboxProviderSchema,
  sandboxSchema,
} from "../schemas/sandbox";
import {
  searchConversationsInputSchema,
  searchHitSchema,
} from "../schemas/search";
import {
  budgetSchema,
  listBudgetsInputSchema,
  listTransactionsInputSchema,
  setBudgetInputSchema,
  transactionSchema,
  usageSummaryInputSchema,
  usageSummarySchema,
} from "../schemas/usage";
import { authed } from "./base";

export const usage = {
  budgets: authed
    .route({
      description: "Budgets in an org: the org's, its teams' and its members'.",
      method: "GET",
      path: "/orgs/{orgId}/budgets",
      summary: "List budgets in an org",
    })
    .input(listBudgetsInputSchema)
    .output(z.array(budgetSchema)),
  deleteBudget: authed
    .route({
      method: "DELETE",
      path: "/budgets/{id}",
      successStatus: 204,
      summary: "Delete a budget",
    })
    .input(z.object({ id: budgetIdSchema }))
    .output(z.void()),
  setBudget: authed
    .route({ method: "PUT", path: "/budgets", summary: "Set a budget" })
    .input(setBudgetInputSchema)
    .output(budgetSchema),
  summary: authed
    .route({
      description:
        "Team totals include sub-teams; org totals include everything in the org.",
      method: "GET",
      path: "/usage/summary",
      summary: "Summarise usage",
    })
    .input(usageSummaryInputSchema)
    .output(usageSummarySchema),
  transactions: authed
    .route({
      method: "GET",
      path: "/usage/transactions",
      summary: "List transactions",
    })
    .input(listTransactionsInputSchema)
    .output(pageOf(transactionSchema)),
};

const bySandbox = z.object({ id: sandboxIdSchema });

export const sandbox = {
  create: authed
    .errors({ ...conflictError, ...featureError })
    .route({
      description:
        "Creates the conversation's sandbox. `CONFLICT` (`already_exists`) if it has one; omitting `provider` uses the instance default.",
      method: "POST",
      path: "/conversations/{conversationId}/sandbox",
      successStatus: 201,
      summary: "Create a sandbox",
    })
    .input(
      z.object({
        conversationId: conversationIdSchema,
        provider: sandboxProviderSchema.optional(),
      })
    )
    .output(sandboxSchema),
  destroy: authed
    .route({
      method: "DELETE",
      path: "/sandboxes/{id}",
      successStatus: 204,
      summary: "Destroy a sandbox",
    })
    .input(bySandbox)
    .output(z.void()),
  exec: authed
    .errors(conflictError)
    .route({
      description: "Runs a command from the panel's terminal and waits for it.",
      method: "POST",
      path: "/sandboxes/{id}/exec",
      summary: "Run a command",
    })
    .input(execInputSchema.extend({ id: sandboxIdSchema }))
    .output(execResultSchema),
  exposePort: authed
    .route({
      method: "POST",
      path: "/sandboxes/{id}/ports",
      summary: "Expose a port for preview",
    })
    .input(z.object({ id: sandboxIdSchema, port: z.int().min(1).max(65_535) }))
    .output(sandboxPreviewSchema),
  get: authed
    .route({
      description: "The conversation's sandbox, or `null`.",
      method: "GET",
      path: "/conversations/{conversationId}/sandbox",
      summary: "Get the conversation's sandbox",
    })
    .input(z.object({ conversationId: conversationIdSchema }))
    .output(sandboxSchema.nullable()),
  listFiles: authed
    .route({
      method: "GET",
      path: "/sandboxes/{id}/files",
      summary: "List sandbox files",
    })
    .input(
      z.object({
        id: sandboxIdSchema,
        path: sandboxPathSchema.default("."),
        recursive: z.boolean().default(false),
      })
    )
    .output(z.array(fileEntrySchema)),
  readFile: authed
    .route({
      method: "GET",
      path: "/sandboxes/{id}/file",
      summary: "Read a sandbox file",
    })
    .input(z.object({ id: sandboxIdSchema, path: sandboxPathSchema }))
    .output(
      z.object({
        /** Text files come back as UTF-8; anything else as base64. */
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]),
        path: sandboxPathSchema,
        size: z.int().min(0),
      })
    ),
  reset: authed
    .route({
      description:
        "Destroys the sandbox and starts a fresh one with the same provider.",
      method: "POST",
      path: "/sandboxes/{id}/reset",
      summary: "Reset a sandbox",
    })
    .input(bySandbox)
    .output(sandboxSchema),
};

export const search = {
  conversations: authed
    .route({
      description:
        "Full-text search over titles and messages the caller can read.",
      method: "GET",
      path: "/search/conversations",
      summary: "Search conversations",
    })
    .input(searchConversationsInputSchema)
    .output(pageOf(searchHitSchema)),
};

export const decisions = {
  list: authed
    .route({
      description: "The Decider's log, for instance admins (audit and tuning).",
      method: "GET",
      path: "/decisions",
      summary: "List Decider decisions",
    })
    .input(listDecisionsInputSchema)
    .output(pageOf(decisionLogEntrySchema)),
};

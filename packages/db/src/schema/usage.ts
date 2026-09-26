import type { ModelRef, ProviderId } from "@workspace/contract/schemas/models";
import {
  type ChatContextType,
  chatContextTypeSchema,
} from "@workspace/contract/schemas/tenancy";
import {
  budgetPeriodSchema,
  usageKindSchema,
} from "@workspace/contract/schemas/usage";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import type { z } from "zod";

import { organization, user } from "./auth";
import { run } from "./chat";
import {
  contextIdRef,
  createdAt,
  idColumn,
  idRef,
  instant,
  oneOf,
  principalIdRef,
  updatedAt,
} from "./columns";
import { PRINCIPAL_TYPES } from "./tenancy";

// Keys and usage (D17, D24). Money is integer micro-USD.

export const KEY_SCOPE_TYPES = ["org", "team", "user"] as const;
export const PAYER_TYPES = ["instance", ...KEY_SCOPE_TYPES] as const;

/**
 * An org, team or user provider key. Instance keys live in app.config.yaml,
 * never here. The key itself is only ever stored sealed (AES-GCM under
 * `ENCRYPTION_KEY`), with the id of the key that sealed it so it can rotate.
 */
export const providerKey = pgTable(
  "provider_key",
  {
    baseUrl: text("base_url"),
    createdAt: createdAt(),
    createdBy: idRef("created_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
    /** The sealed key. Never logged, never returned. */
    encryptedKey: text("encrypted_key").notNull(),
    /** The last four characters, for recognising a key. */
    hint: text("hint").notNull(),
    id: idColumn("providerKey"),
    keyId: text("key_id").notNull(),
    label: text("label").notNull().default(""),
    lastUsedAt: instant("last_used_at"),
    provider: text("provider").$type<ProviderId>().notNull(),
    scopeId: principalIdRef("scope_id").notNull(),
    scopeType: text("scope_type")
      .$type<(typeof KEY_SCOPE_TYPES)[number]>()
      .notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("provider_key_scope_idx").on(t.scopeType, t.scopeId, t.provider),
    check("provider_key_scope_type", oneOf(t.scopeType, KEY_SCOPE_TYPES)),
  ]
);

/**
 * One model call's cost, recorded against the user and the chat context
 * (D17). `orgId` is the context's org, so org roll-ups need no tree walk;
 * team roll-ups walk the team tree.
 */
export const transaction = pgTable(
  "transaction",
  {
    cachedInputTokens: integer("cached_input_tokens"),
    contextId: contextIdRef("context_id").notNull(),
    contextType: text("context_type").$type<ChatContextType>().notNull(),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
    createdAt: createdAt(),
    id: idColumn("transaction"),
    inputTokens: integer("input_tokens").notNull(),
    kind: text("kind").$type<z.infer<typeof usageKindSchema>>().notNull(),
    model: text("model").$type<ModelRef>().notNull(),
    orgId: idRef("org_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    outputTokens: integer("output_tokens").notNull(),
    /** `null` for instance keys. */
    paidById: principalIdRef("paid_by_id"),
    paidByType: text("paid_by_type")
      .$type<(typeof PAYER_TYPES)[number]>()
      .notNull(),
    reasoningTokens: integer("reasoning_tokens"),
    runId: idRef("run_id", "run").references(() => run.id, {
      onDelete: "set null",
    }),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("transaction_user_idx").on(t.userId, t.createdAt),
    index("transaction_context_idx").on(
      t.contextType,
      t.contextId,
      t.createdAt
    ),
    index("transaction_org_idx").on(t.orgId, t.createdAt),
    index("transaction_run_idx").on(t.runId),
    check("transaction_kind", oneOf(t.kind, usageKindSchema.options)),
    check(
      "transaction_context_type",
      oneOf(t.contextType, chatContextTypeSchema.options)
    ),
    check("transaction_paid_by_type", oneOf(t.paidByType, PAYER_TYPES)),
    check(
      "transaction_paid_by_id",
      sql`(${t.paidByType} = 'instance') = (${t.paidById} is null)`
    ),
    check("transaction_cost_non_negative", sql`${t.costMicros} >= 0`),
  ]
);

/**
 * Running spend per principal and budget period, kept in step with
 * `transaction` by `recordTransaction`, so a budget check before a run is one
 * indexed read instead of a sum over history. Teams include their
 * sub-teams' spend (usage rolls up, D17).
 */
export const balance = pgTable(
  "balance",
  {
    /** A user's spend is kept per org, matching `budget` (a user's cap is per org). */
    orgId: idRef("org_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    period: text("period")
      .$type<z.infer<typeof budgetPeriodSchema>>()
      .notNull(),
    /** Start of the period, UTC (`periodStart`). */
    periodStart: instant("period_start").notNull(),
    principalId: principalIdRef("principal_id").notNull(),
    principalType: text("principal_type")
      .$type<(typeof PRINCIPAL_TYPES)[number]>()
      .notNull(),
    spentMicros: bigint("spent_micros", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.orgId,
        t.principalType,
        t.principalId,
        t.period,
        t.periodStart,
      ],
    }),
    check("balance_period", oneOf(t.period, budgetPeriodSchema.options)),
    check("balance_principal_type", oneOf(t.principalType, PRINCIPAL_TYPES)),
  ]
);

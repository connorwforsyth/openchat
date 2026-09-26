import type {
  ChatContextType,
  PublishGate,
} from "@workspace/contract/schemas/tenancy";
import {
  chatContextTypeSchema,
  publishGateSchema,
  teamRoleSchema,
} from "@workspace/contract/schemas/tenancy";
import { budgetPeriodSchema } from "@workspace/contract/schemas/usage";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { invitation, organization, user } from "./auth";
import {
  createdAt,
  idColumn,
  idRef,
  oneOf,
  principalIdRef,
  updatedAt,
} from "./columns";

// Tenancy (PLAN.md D17): our own team tree inside Better Auth's orgs (its
// teams are flat), per-org policy choices, and budgets.

export const PRINCIPAL_TYPES = ["user", "team", "org"] as const;

export const team = pgTable(
  "team",
  {
    createdAt: createdAt(),
    id: idColumn("team"),
    name: text("name").notNull(),
    orgId: idRef("org_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * `null` for a top-level team. No cascade: removing a team with sub-teams
     * is a decision (re-parent or remove them), not a side effect.
     */
    parentId: idRef("parent_id", "team").references((): AnyPgColumn => team.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("team_org_id_idx").on(t.orgId),
    index("team_parent_id_idx").on(t.parentId),
    check("team_parent_not_self", sql`${t.parentId} <> ${t.id}`),
  ]
);

export const teamMember = pgTable(
  "team_member",
  {
    addedAt: createdAt(),
    role: text("role").notNull().default("member"),
    teamId: idRef("team_id", "team")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index("team_member_user_id_idx").on(t.userId),
    check("team_member_role", oneOf(t.role, teamRoleSchema.options)),
  ]
);

/**
 * Teams an invitee joins on accepting. Better Auth's `invitation.teamId` is
 * for its flat teams, so the link to ours lives here.
 */
export const invitationTeam = pgTable(
  "invitation_team",
  {
    invitationId: idRef("invitation_id", "invitation")
      .notNull()
      .references(() => invitation.id, { onDelete: "cascade" }),
    teamId: idRef("team_id", "team")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.invitationId, t.teamId] })]
);

/**
 * An org's policy choices (`orgPolicySchema`), one column each so admin
 * queries can filter on them. The instance limits in app.config.yaml clamp
 * them on read (`clampOrgPolicy`); no row means every default.
 */
export const orgSettings = pgTable(
  "org_settings",
  {
    auditEnabled: boolean("audit_enabled").notNull().default(false),
    chatContexts: text("chat_contexts")
      .array()
      .$type<ChatContextType[]>()
      .notNull()
      .default(sql`'{personal,team,org}'::text[]`),
    orgId: idRef("org_id", "org")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    personalKeyFallback: boolean("personal_key_fallback")
      .notNull()
      .default(false),
    publishGate: text("publish_gate")
      .$type<PublishGate>()
      .notNull()
      .default("informational"),
    sampledScoring: boolean("sampled_scoring").notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: idRef("updated_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check(
      "org_settings_publish_gate",
      oneOf(t.publishGate, publishGateSchema.options)
    ),
    check(
      "org_settings_chat_contexts",
      sql`${t.chatContexts} <@ ${sql.raw(`'{${chatContextTypeSchema.options.join(",")}}'::text[]`)} and cardinality(${t.chatContexts}) > 0`
    ),
  ]
);

/**
 * A spending limit for a user, team or org, per period (D24). Every budget
 * belongs to an org: a user's budget caps their spend in that org's contexts
 * (their personal org for personal chats). Spend is read from `balance`.
 */
export const budget = pgTable(
  "budget",
  {
    createdAt: createdAt(),
    /** Block new runs when spent, or only warn. */
    hard: boolean("hard").notNull().default(true),
    id: idColumn("budget"),
    limitMicros: bigint("limit_micros", { mode: "number" }).notNull(),
    orgId: idRef("org_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    period: text("period")
      .$type<(typeof budgetPeriodSchema.options)[number]>()
      .notNull(),
    principalId: principalIdRef("principal_id").notNull(),
    principalType: text("principal_type")
      .$type<(typeof PRINCIPAL_TYPES)[number]>()
      .notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("budget_principal_period_uidx").on(
      t.orgId,
      t.principalType,
      t.principalId,
      t.period
    ),
    check("budget_period", oneOf(t.period, budgetPeriodSchema.options)),
    check("budget_principal_type", oneOf(t.principalType, PRINCIPAL_TYPES)),
    check("budget_limit_non_negative", sql`${t.limitMicros} >= 0`),
  ]
);

import { allowanceGrantStatusSchema } from "@workspace/contract/schemas/spaces";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import {
  createdAt,
  idRef,
  instant,
  oneOf,
  principalIdRef,
  updatedAt,
} from "./columns";

// Space token allowances (ticket 192). A space is an org or a team (188), so
// rows name it by `space_type` and `space_id` like a grant principal, plus
// the org for cascade and roll-ups. Tokens, not money: money budgets (D24)
// are separate.

export const SPACE_TYPES = ["org", "team"] as const;

/** A space's monthly token pool, set by an owner. No row: no allowance. */
export const spaceAllowance = pgTable(
  "space_allowance",
  {
    monthlyTokens: bigint("monthly_tokens", { mode: "number" }).notNull(),
    orgId: idRef("org_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: principalIdRef("space_id").notNull(),
    spaceType: text("space_type")
      .$type<(typeof SPACE_TYPES)[number]>()
      .notNull(),
    updatedAt: updatedAt(),
    updatedBy: idRef("updated_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.spaceType, t.spaceId] }),
    check("space_allowance_type", oneOf(t.spaceType, SPACE_TYPES)),
    check("space_allowance_non_negative", sql`${t.monthlyTokens} >= 0`),
  ]
);

/** A member's monthly draw on a space's pool: requested by them, decided by an owner. */
export const spaceAllowanceGrant = pgTable(
  "space_allowance_grant",
  {
    decidedAt: instant("decided_at"),
    decidedBy: idRef("decided_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
    id: uuid("id").primaryKey().defaultRandom(),
    monthlyTokens: bigint("monthly_tokens", { mode: "number" }).notNull(),
    note: text("note").notNull().default(""),
    orgId: idRef("org_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestedAt: createdAt(),
    spaceId: principalIdRef("space_id").notNull(),
    spaceType: text("space_type")
      .$type<(typeof SPACE_TYPES)[number]>()
      .notNull(),
    status: text("status")
      .$type<(typeof allowanceGrantStatusSchema.options)[number]>()
      .notNull()
      .default("pending"),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    // One grant per member and space; a new request replaces the old one.
    uniqueIndex("space_allowance_grant_member_uidx").on(
      t.spaceType,
      t.spaceId,
      t.userId
    ),
    index("space_allowance_grant_user_idx").on(t.userId),
    check("space_allowance_grant_type", oneOf(t.spaceType, SPACE_TYPES)),
    check(
      "space_allowance_grant_status",
      oneOf(t.status, allowanceGrantStatusSchema.options)
    ),
    check("space_allowance_grant_positive", sql`${t.monthlyTokens} > 0`),
  ]
);

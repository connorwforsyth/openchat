import type {
  ShortcutOverridesSetting,
  SidebarLayoutSetting,
} from "@workspace/contract/schemas/meta";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, idColumn, idRef, instant, updatedAt } from "./columns";

// Better Auth's tables (core, organization, admin and bearer plugins), in the
// shape `auth generate` emits for the Drizzle adapter's `relations-v2` entry
// (docs/decisions/0001), with three changes of ours:
// - ids are UUIDv7 (ticket 008): `uuid` columns filled by `newId`, so
//   Better Auth must be configured with `advanced.database.generateId`
//   returning `newId(...)` (or left to omit ids, which the defaults fill);
// - timestamps carry a time zone;
// - `user.locale` and `organization.isPersonal` (PLAN.md §7, D17).
// Keep the field names: the adapter maps Better Auth's model fields to these
// properties by name.

export const user = pgTable("user", {
  banExpires: instant("ban_expires"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  createdAt: createdAt(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  id: idColumn("user"),
  image: text("image"),
  /** Saved UI locale (BCP 47); `null` negotiates from the browser. */
  locale: text("locale"),
  name: text("name").notNull(),
  /** Admin plugin: `admin` is the instance admin (the first user, D22). */
  role: text("role"),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    activeOrganizationId: text("active_organization_id"),
    createdAt: createdAt(),
    expiresAt: instant("expires_at").notNull(),
    id: idColumn("session"),
    impersonatedBy: text("impersonated_by"),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: updatedAt(),
    userAgent: text("user_agent"),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = pgTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: createdAt(),
    id: idColumn("account"),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: updatedAt(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("account_user_id_idx").on(t.userId)]
);

export const verification = pgTable(
  "verification",
  {
    createdAt: createdAt(),
    expiresAt: instant("expires_at").notNull(),
    id: idColumn("verification"),
    identifier: text("identifier").notNull(),
    updatedAt: updatedAt(),
    value: text("value").notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

export const organization = pgTable(
  "organization",
  {
    createdAt: createdAt(),
    id: idColumn("org"),
    /** The hidden per-user org behind the Personal context (D17). */
    isPersonal: boolean("is_personal").default(false).notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [uniqueIndex("organization_slug_uidx").on(t.slug)]
);

export const member = pgTable(
  "member",
  {
    createdAt: createdAt(),
    id: idColumn("member"),
    organizationId: idRef("organization_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `owner | admin | member`; Better Auth may store several, comma-separated. */
    role: text("role").default("member").notNull(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("member_organization_id_idx").on(t.organizationId),
    index("member_user_id_idx").on(t.userId),
    uniqueIndex("member_org_user_uidx").on(t.organizationId, t.userId),
  ]
);

export const invitation = pgTable(
  "invitation",
  {
    createdAt: createdAt(),
    email: text("email").notNull(),
    expiresAt: instant("expires_at").notNull(),
    id: idColumn("invitation"),
    inviterId: idRef("inviter_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: idRef("organization_id", "org")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role"),
    status: text("status").default("pending").notNull(),
  },
  (t) => [
    index("invitation_organization_id_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ]
);

// --- Ours, next to Better Auth's ---

/** Per-user defaults (`userSettingsSchema`); the locale lives on `user`. */
export const userSettings = pgTable("user_settings", {
  defaultContext: jsonb("default_context")
    .$type<ChatContext>()
    .notNull()
    .default({ type: "personal" }),
  defaultTarget: jsonb("default_target").$type<RunTarget>(),
  /** Recorded shortcuts (Q31): id to combos, parsed leniently by `@workspace/shortcuts`. */
  shortcuts: jsonb("shortcuts")
    .$type<ShortcutOverridesSetting>()
    .notNull()
    .default({}),
  /** Rail or classic (181); `null` until the user picks one. */
  sidebarLayout: text("sidebar_layout").$type<SidebarLayoutSetting>(),
  updatedAt: updatedAt(),
  userId: idRef("user_id", "user")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
});

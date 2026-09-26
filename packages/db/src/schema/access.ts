import {
  chatPermissionSchema,
  type GrantableResourceType,
  grantableResourceTypeSchema,
} from "@workspace/contract/schemas/grants";
import { libraryPermissionSchema } from "@workspace/contract/schemas/library";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import {
  createdAt,
  idColumn,
  idRef,
  instant,
  oneOf,
  principalIdRef,
  updatedAt,
} from "./columns";
import { PRINCIPAL_TYPES } from "./tenancy";

// Access (D13, D25). `resource_grant` is the only source of access beyond
// ownership: nothing else (participant rows, team membership on its own)
// grants anything. Resources are polymorphic, so there's no foreign key;
// deleting a resource deletes its grants in the same transaction
// (`deleteGrantsForResource`).

export type GrantPermission =
  | (typeof chatPermissionSchema.options)[number]
  | (typeof libraryPermissionSchema.options)[number];

export const resourceGrant = pgTable(
  "resource_grant",
  {
    createdAt: createdAt(),
    grantedBy: idRef("granted_by", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: idColumn("grant"),
    /** Chats: `viewer | editor`; library items: `use | view | edit`. */
    permission: text("permission").$type<GrantPermission>().notNull(),
    principalId: principalIdRef("principal_id").notNull(),
    principalType: text("principal_type")
      .$type<(typeof PRINCIPAL_TYPES)[number]>()
      .notNull(),
    resourceId: uuid("resource_id").notNull(),
    resourceType: text("resource_type")
      .$type<GrantableResourceType>()
      .notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Re-granting a principal replaces the level, so one row per pair.
    uniqueIndex("resource_grant_resource_principal_uidx").on(
      t.resourceType,
      t.resourceId,
      t.principalType,
      t.principalId
    ),
    index("resource_grant_principal_idx").on(t.principalType, t.principalId),
    check(
      "resource_grant_resource_type",
      oneOf(t.resourceType, grantableResourceTypeSchema.options)
    ),
    check(
      "resource_grant_principal_type",
      oneOf(t.principalType, PRINCIPAL_TYPES)
    ),
    // The permission enum depends on the resource type (contract `grants`).
    check(
      "resource_grant_permission",
      sql`(${t.resourceType} = 'conversation' and ${oneOf(t.permission, chatPermissionSchema.options)}) or (${t.resourceType} <> 'conversation' and ${oneOf(t.permission, libraryPermissionSchema.options)})`
    ),
  ]
);

/** A public read-only link to a chat or library item, if the instance allows them. */
export const shareLink = pgTable(
  "share_link",
  {
    createdAt: createdAt(),
    createdBy: idRef("created_by", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: instant("expires_at"),
    id: idColumn("shareLink"),
    resourceId: uuid("resource_id").notNull(),
    resourceType: text("resource_type")
      .$type<GrantableResourceType>()
      .notNull(),
    revokedAt: instant("revoked_at"),
    /** Unguessable, and the only credential the link needs. */
    token: text("token").notNull(),
  },
  (t) => [
    uniqueIndex("share_link_token_uidx").on(t.token),
    index("share_link_resource_idx").on(t.resourceType, t.resourceId),
    check(
      "share_link_resource_type",
      oneOf(t.resourceType, grantableResourceTypeSchema.options)
    ),
  ]
);

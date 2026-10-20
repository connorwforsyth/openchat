import type {
  AgentDefinition,
  McpServerDefinition,
  PresetDefinition,
  PromptDefinition,
  SkillDefinition,
} from "@workspace/contract/schemas/library";
import type { Id } from "@workspace/shared/ids";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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

// Library items (D13). An item is owned by a user, or by a team or org once
// published into its library (with maintainers). Agents, prompts and skills
// are versioned: edits go to the one draft, publishing freezes it as the
// next number. MCP servers and presets are edited in place (ticket 008).
// Visibility isn't stored: it's derived from ownership, grants and share links.

export const VERSION_STATUSES = ["draft", "published"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

const itemColumns = () => ({
  createdAt: createdAt(),
  createdBy: idRef("created_by", "user")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  description: text("description").notNull().default(""),
  /** An icon registry name or an emoji. */
  icon: text("icon"),
  id: idColumn("libraryItem"),
  /** Maintainers of a published item; empty for personal items. */
  maintainers: uuid("maintainers")
    .$type<Id<"user">>()
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  name: text("name").notNull(),
  ownerId: principalIdRef("owner_id").notNull(),
  ownerType: text("owner_type")
    .$type<(typeof PRINCIPAL_TYPES)[number]>()
    .notNull(),
  /** The personal item this was published from; not a foreign key, the source may go. */
  publishedFrom: idRef("published_from", "libraryItem"),
  updatedAt: updatedAt(),
});

const itemIndexes = (
  name: string,
  t: {
    ownerId: AnyPgColumn;
    ownerType: AnyPgColumn;
  }
) => [
  index(`${name}_owner_idx`).on(t.ownerType, t.ownerId),
  check(`${name}_owner_type`, oneOf(t.ownerType, PRINCIPAL_TYPES)),
];

const versionColumns = () => ({
  createdAt: createdAt(),
  createdBy: idRef("created_by", "user")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  id: idColumn("libraryVersion"),
  notes: text("notes"),
  /** 1, 2, 3… once published; `null` for the draft. */
  number: integer("number"),
  publishedAt: instant("published_at"),
  status: text("status").$type<VersionStatus>().notNull(),
  updatedAt: updatedAt(),
});

const versionIndexes = (
  name: string,
  t: {
    itemId: AnyPgColumn;
    number: AnyPgColumn;
    publishedAt: AnyPgColumn;
    status: AnyPgColumn;
  }
) => [
  uniqueIndex(`${name}_number_uidx`).on(t.itemId, t.number),
  // One draft per item: edits always land in the same row.
  uniqueIndex(`${name}_draft_uidx`)
    .on(t.itemId)
    .where(sql`${t.status} = 'draft'`),
  check(`${name}_status`, oneOf(t.status, VERSION_STATUSES)),
  check(
    `${name}_published_shape`,
    sql`(${t.status} = 'draft' and ${t.number} is null and ${t.publishedAt} is null) or (${t.status} = 'published' and ${t.number} >= 1 and ${t.publishedAt} is not null)`
  ),
];

/** Pointers from a versioned item to its draft and latest published version. */
const versionPointers = (versionTable: () => AnyPgColumn) => ({
  draftVersionId: idRef("draft_version_id", "libraryVersion").references(
    versionTable,
    { onDelete: "set null" }
  ),
  latestVersionId: idRef("latest_version_id", "libraryVersion").references(
    versionTable,
    { onDelete: "set null" }
  ),
});

export const agent = pgTable(
  "agent",
  {
    ...itemColumns(),
    ...versionPointers((): AnyPgColumn => agentVersion.id),
  },
  (t) => itemIndexes("agent", t)
);

/** Instructions, model, tools, MCP servers, skills, knowledge, starters, sandbox. */
export const agentVersion = pgTable(
  "agent_version",
  {
    ...versionColumns(),
    definition: jsonb("definition").$type<AgentDefinition>().notNull(),
    itemId: idRef("item_id", "libraryItem")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
  },
  (t) => versionIndexes("agent_version", t)
);

export const prompt = pgTable(
  "prompt",
  {
    ...itemColumns(),
    ...versionPointers((): AnyPgColumn => promptVersion.id),
  },
  (t) => itemIndexes("prompt", t)
);

export const promptVersion = pgTable(
  "prompt_version",
  {
    ...versionColumns(),
    definition: jsonb("definition").$type<PromptDefinition>().notNull(),
    itemId: idRef("item_id", "libraryItem")
      .notNull()
      .references(() => prompt.id, { onDelete: "cascade" }),
  },
  (t) => versionIndexes("prompt_version", t)
);

export const skill = pgTable(
  "skill",
  {
    ...itemColumns(),
    ...versionPointers((): AnyPgColumn => skillVersion.id),
  },
  (t) => itemIndexes("skill", t)
);

/** `SKILL.md`; the bundled files are `skill_file` rows (in `files`). */
export const skillVersion = pgTable(
  "skill_version",
  {
    ...versionColumns(),
    definition: jsonb("definition")
      .$type<Omit<SkillDefinition, "files">>()
      .notNull(),
    itemId: idRef("item_id", "libraryItem")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
  },
  (t) => versionIndexes("skill_version", t)
);

/**
 * A saved MCP server (HTTP/SSE server-side). `definition.auth` holds what the
 * API may return; a header secret is encrypted apart from it (D24).
 */
export const mcpServer = pgTable(
  "mcp_server",
  {
    ...itemColumns(),
    definition: jsonb("definition").$type<McpServerDefinition>().notNull(),
    /** AES-GCM ciphertext of the header secret, or `null`. */
    secretCiphertext: text("secret_ciphertext"),
    /** Which `ENCRYPTION_KEY` sealed it, so keys can rotate. */
    secretKeyId: text("secret_key_id"),
  },
  (t) => [
    ...itemIndexes("mcp_server", t),
    check(
      "mcp_server_secret_key_id",
      sql`(${t.secretCiphertext} is null) = (${t.secretKeyId} is null)`
    ),
  ]
);

/**
 * A user's OAuth tokens for an MCP server; each user authorises for
 * themselves. `mcpServerId` is a library server or an instance server from
 * app.config.yaml (184), which has no row, so it isn't a foreign key:
 * deleting a library server deletes its tokens explicitly.
 */
export const mcpOauthToken = pgTable(
  "mcp_oauth_token",
  {
    ciphertext: text("ciphertext").notNull(),
    createdAt: createdAt(),
    expiresAt: instant("expires_at"),
    keyId: text("key_id").notNull(),
    mcpServerId: idRef("mcp_server_id", "libraryItem").notNull(),
    updatedAt: updatedAt(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.mcpServerId, t.userId] })]
);

/**
 * A user's on/off choice for one connector (184): an instance server or a
 * library server. No row means the operator's default (instance) or on
 * (library). Not a foreign key, for the same reason as `mcp_oauth_token`.
 */
export const mcpConnectorPref = pgTable(
  "mcp_connector_pref",
  {
    enabled: boolean("enabled").notNull(),
    mcpServerId: idRef("mcp_server_id", "libraryItem").notNull(),
    updatedAt: updatedAt(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mcpServerId] })]
);

/** Model, parameters and instructions. */
export const preset = pgTable(
  "preset",
  {
    ...itemColumns(),
    definition: jsonb("definition").$type<PresetDefinition>().notNull(),
  },
  (t) => itemIndexes("preset", t)
);

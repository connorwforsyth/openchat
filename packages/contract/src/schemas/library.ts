import { z } from "zod";

import {
  descriptionSchema,
  fileIdSchema,
  jsonValueSchema,
  libraryItemIdSchema,
  libraryVersionIdSchema,
  nameSchema,
  orgIdSchema,
  pageInputSchema,
  teamIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { toolNameSchema } from "./message-parts";
import { modelParametersSchema, modelSelectorSchema } from "./models";
import { sandboxProviderSchema } from "./sandbox";
import { principalSchema, userSummarySchema } from "./tenancy";

// Library items (D13): agents, prompts, skills, MCP servers and presets.
// Items are owned by a user; *sharing* grants access (`resource_grant`), and
// *publishing* copies the item into a team or org library, which then owns it
// with the publisher as a maintainer. Agents, prompts and skills are
// versioned: edits go to a draft, `publishVersion` freezes it, and consumers
// get the latest published version unless they pin one. MCP servers and
// presets are plain config, edited in place (PLAN.md §7).

export const libraryKindSchema = z.enum([
  "agent",
  "prompt",
  "skill",
  "mcp_server",
  "preset",
]);
export type LibraryKind = z.infer<typeof libraryKindSchema>;

export const versionedLibraryKinds = [
  "agent",
  "prompt",
  "skill",
] as const satisfies readonly LibraryKind[];

export const isVersionedLibraryKind = (kind: LibraryKind): boolean =>
  (versionedLibraryKinds as readonly LibraryKind[]).includes(kind);

/** Grantable levels; each includes the ones before it. */
export const libraryPermissionSchema = z.enum(["use", "view", "edit"]);
export type LibraryPermission = z.infer<typeof libraryPermissionSchema>;

/**
 * The caller's effective access. `owner` owns a personal item; `maintainer`
 * maintains a published one. Both imply `edit`.
 */
export const libraryAccessSchema = z.enum([
  "owner",
  "maintainer",
  "edit",
  "view",
  "use",
]);
export type LibraryAccess = z.infer<typeof libraryAccessSchema>;

/** Derived from ownership, grants and share links. */
export const libraryVisibilitySchema = z.enum([
  "private",
  "shared",
  "published",
  "public-link",
]);

/** How an agent treats tool calls: run them, or ask a human first. */
export const toolApprovalModeSchema = z.enum(["auto", "ask"]);

export const agentDefinitionSchema = z.object({
  approvals: z
    .object({
      default: toolApprovalModeSchema.default("auto"),
      /** Per-tool overrides, by tool name. */
      tools: z.record(toolNameSchema, toolApprovalModeSchema).default({}),
    })
    .prefault({}),
  conversationStarters: z.array(z.string().min(1).max(500)).max(8).default([]),
  instructions: z.string().max(100_000),
  kind: z.literal("agent"),
  /** Files searched with `file_search`. Hidden from `use`-only consumers. */
  knowledgeFileIds: z.array(fileIdSchema).max(500).default([]),
  mcpServers: z
    .array(
      z.object({
        id: libraryItemIdSchema,
        /** A subset of the server's tools; omitted means all of them. */
        tools: z.array(toolNameSchema).optional(),
      })
    )
    .max(50)
    .default([]),
  model: modelSelectorSchema,
  parameters: modelParametersSchema.default({}),
  /** `null` means no sandbox tools. */
  sandboxProvider: sandboxProviderSchema.nullable().default(null),
  skills: z
    .array(
      z.object({
        id: libraryItemIdSchema,
        versionId: libraryVersionIdSchema.optional(),
      })
    )
    .max(50)
    .default([]),
  /** Built-in tools by name (`web_search`, `file_search`, `bash`, …). */
  tools: z.array(toolNameSchema).max(100).default([]),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const promptVariableSchema = z.object({
  default: z.string().max(10_000).optional(),
  description: z.string().max(500).optional(),
  name: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "a `{{variable}}` name"),
});

export const promptDefinitionSchema = z.object({
  /** Optional `/command` to launch it from the composer. */
  command: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, "a lowercase slash command")
    .optional(),
  kind: z.literal("prompt"),
  /** Text with `{{variable}}` placeholders. */
  template: z.string().min(1).max(100_000),
  variables: z.array(promptVariableSchema).max(50).default([]),
});
export type PromptDefinition = z.infer<typeof promptDefinitionSchema>;

/** A file bundled with a skill (scripts, resources), stored as an uploaded file. */
export const skillFileSchema = z.object({
  fileId: fileIdSchema,
  /** Relative to the skill root; never absolute, never `..`. */
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/, "a relative path"),
});

/** Agent Skills format: `SKILL.md` (frontmatter + instructions) plus files. */
export const skillDefinitionSchema = z.object({
  files: z.array(skillFileSchema).max(500).default([]),
  kind: z.literal("skill"),
  skillMd: z.string().min(1).max(200_000),
});
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

export const mcpTransportSchema = z.enum(["http", "sse"]);

/** MCP auth as stored and returned: secrets are never sent back, only whether one is set. */
export const mcpAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    scopes: z.array(z.string()).default([]),
    type: z.literal("oauth"),
  }),
  z.object({
    configured: z.boolean(),
    headerName: z.string().min(1).max(128),
    type: z.literal("header"),
  }),
]);

/** MCP auth on create/update: a header secret is write-only; omit `value` to keep the stored one. */
export const mcpAuthInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    scopes: z.array(z.string()).default([]),
    type: z.literal("oauth"),
  }),
  z.object({
    headerName: z.string().min(1).max(128),
    type: z.literal("header"),
    value: z
      .string()
      .min(1)
      .max(8192)
      .describe("Write-only secret; never returned.")
      .optional(),
  }),
]);

const mcpServerFields = {
  kind: z.literal("mcp_server"),
  // HTTP/SSE run server-side; stdio arrives with the Desktop wave.
  transport: mcpTransportSchema,
  url: z.url(),
};

export const mcpServerDefinitionSchema = z.object({
  ...mcpServerFields,
  auth: mcpAuthSchema,
});
export type McpServerDefinition = z.infer<typeof mcpServerDefinitionSchema>;

export const mcpServerDefinitionInputSchema = z.object({
  ...mcpServerFields,
  auth: mcpAuthInputSchema.default({ type: "none" }),
});

export const presetDefinitionSchema = z.object({
  instructions: z.string().max(100_000).optional(),
  kind: z.literal("preset"),
  model: modelSelectorSchema,
  parameters: modelParametersSchema.default({}),
});
export type PresetDefinition = z.infer<typeof presetDefinitionSchema>;

/** An item's content, keyed by kind. */
export const libraryDefinitionSchema = z.discriminatedUnion("kind", [
  agentDefinitionSchema,
  promptDefinitionSchema,
  skillDefinitionSchema,
  mcpServerDefinitionSchema,
  presetDefinitionSchema,
]);
export type LibraryDefinition = z.infer<typeof libraryDefinitionSchema>;

/** Same as `libraryDefinitionSchema`, with write-only secrets for MCP servers. */
export const libraryDefinitionInputSchema = z.discriminatedUnion("kind", [
  agentDefinitionSchema,
  promptDefinitionSchema,
  skillDefinitionSchema,
  mcpServerDefinitionInputSchema,
  presetDefinitionSchema,
]);
export type LibraryDefinitionInput = z.infer<
  typeof libraryDefinitionInputSchema
>;

export const libraryItemSchema = z.object({
  createdAt: timestampSchema,
  createdBy: userIdSchema,
  description: descriptionSchema,
  /** The editable draft (versioned kinds, callers with `edit`); `null` otherwise. */
  draftVersionId: libraryVersionIdSchema.nullable(),
  /** An icon registry name or an emoji. */
  icon: z.string().max(64).nullable(),
  id: libraryItemIdSchema,
  kind: libraryKindSchema,
  /** Latest published version (versioned kinds); `null` if never published. */
  latestVersionId: libraryVersionIdSchema.nullable(),
  latestVersionNumber: z.int().min(1).nullable(),
  /** Maintainers of a published item; empty for personal items. */
  maintainers: z.array(userSummarySchema),
  myAccess: libraryAccessSchema,
  name: nameSchema,
  owner: principalSchema,
  /** The personal item this was published from, if any. */
  publishedFrom: libraryItemIdSchema.nullable(),
  updatedAt: timestampSchema,
  visibility: libraryVisibilitySchema,
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

/**
 * An item with its content. `definition` is `null` when the caller only has
 * `use`: they can chat with it but not see instructions or knowledge files.
 */
export const libraryItemDetailSchema = libraryItemSchema.extend({
  definition: libraryDefinitionSchema.nullable(),
  /** Which version `definition` is: `null` for unversioned kinds. */
  versionId: libraryVersionIdSchema.nullable(),
});
export type LibraryItemDetail = z.infer<typeof libraryItemDetailSchema>;

export const libraryVersionSchema = z.object({
  createdAt: timestampSchema,
  createdBy: userIdSchema,
  definition: libraryDefinitionSchema,
  id: libraryVersionIdSchema,
  itemId: libraryItemIdSchema,
  notes: z.string().max(4000).nullable(),
  /** 1, 2, 3… for published versions; `null` for the draft. */
  number: z.int().min(1).nullable(),
  publishedAt: timestampSchema.nullable(),
  status: z.enum(["draft", "published"]),
});
export type LibraryVersion = z.infer<typeof libraryVersionSchema>;

/** Library UI tabs (D13). `libraries` is team and org libraries the caller can see. */
export const libraryTabSchema = z.enum(["mine", "shared", "libraries"]);

export const listLibraryInputSchema = pageInputSchema.extend({
  kind: libraryKindSchema.optional(),
  /** Narrow the `libraries` tab to one team or org library (flat, for the query string). */
  ownerId: z.union([teamIdSchema, orgIdSchema]).optional(),
  ownerType: z.enum(["team", "org"]).optional(),
  query: z.string().trim().max(200).optional(),
  tab: libraryTabSchema,
});

/** Which content `library.get` returns: the draft (editors), the latest published, or a version. */
export const libraryRevisionSchema = z.union([
  z.enum(["draft", "latest"]),
  libraryVersionIdSchema,
]);

export const getLibraryItemInputSchema = z.object({
  id: libraryItemIdSchema,
  revision: libraryRevisionSchema.default("latest"),
});

export const createLibraryItemInputSchema = z.object({
  definition: libraryDefinitionInputSchema,
  description: descriptionSchema.default(""),
  icon: z.string().max(64).nullable().default(null),
  name: nameSchema,
});

/**
 * Edits the draft (versioned kinds) or the item itself. `definition.kind` must
 * match the item's kind (`VALIDATION` otherwise).
 */
export const updateLibraryItemInputSchema = z.object({
  definition: libraryDefinitionInputSchema.optional(),
  description: descriptionSchema.optional(),
  icon: z.string().max(64).nullable().optional(),
  id: libraryItemIdSchema,
  name: nameSchema.optional(),
});

export const publishVersionInputSchema = z.object({
  id: libraryItemIdSchema,
  notes: z.string().max(4000).optional(),
});

/** Copies a published version into the draft, to edit from there. */
export const restoreVersionInputSchema = z.object({
  id: libraryItemIdSchema,
  versionId: libraryVersionIdSchema,
});

/** Where `publishToLibrary` puts the copy: a team or org library, never a user. */
export const libraryTargetSchema = z.discriminatedUnion("type", [
  z.object({ id: teamIdSchema, type: z.literal("team") }),
  z.object({ id: orgIdSchema, type: z.literal("org") }),
]);

export const publishToLibraryInputSchema = z.object({
  id: libraryItemIdSchema,
  target: libraryTargetSchema,
  /** Which published version to copy; omitted means the latest. */
  versionId: libraryVersionIdSchema.optional(),
});

export const duplicateLibraryItemInputSchema = z.object({
  id: libraryItemIdSchema,
  name: nameSchema.optional(),
});

export const setMaintainersInputSchema = z.object({
  id: libraryItemIdSchema,
  userIds: z.array(userIdSchema).min(1).max(100),
});

/** Our own export format: one item, portable between instances. */
export const libraryExportSchema = z.object({
  definition: libraryDefinitionSchema,
  description: descriptionSchema,
  exportedAt: timestampSchema,
  format: z.literal("native"),
  formatVersion: z.literal(1),
  icon: z.string().max(64).nullable(),
  name: nameSchema,
});
export type LibraryExport = z.infer<typeof libraryExportSchema>;

/** Import accepts our format, or a LibreChat agent export (validated by the importer). */
export const libraryImportInputSchema = z.object({
  document: z.discriminatedUnion("format", [
    libraryExportSchema,
    z.object({
      data: jsonValueSchema,
      format: z.literal("librechat-agent"),
    }),
  ]),
});

/** An MCP server's live connection state, for the builder and the tool picker. */
export const mcpConnectionStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("connected"), toolCount: z.int().min(0) }),
  z.object({ state: z.literal("needs_auth") }),
  z.object({ message: z.string(), state: z.literal("error") }),
  z.object({ state: z.literal("disabled") }),
]);
export type McpConnectionStatus = z.infer<typeof mcpConnectionStatusSchema>;

export const mcpToolSchema = z.object({
  description: z.string().nullable(),
  inputSchema: jsonValueSchema,
  name: toolNameSchema,
});
export type McpTool = z.infer<typeof mcpToolSchema>;

// Connectors (184): the MCP servers one user sees, merged from the
// operator's catalog in app.config.yaml and the user's own library, with
// the user's on/off choice applied. `lock` says why a toggle is fixed.

/** Why a connector can't be toggled: the operator requires it, or fixed its state. */
export const connectorLockSchema = z.object({
  reason: z.string().max(500).nullable(),
  type: z.enum(["required", "operator"]),
});
export type ConnectorLock = z.infer<typeof connectorLockSchema>;

/** Whether this surface can run the connector at all. */
export const connectorAvailabilitySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available") }),
  /** stdio servers run in the desktop app, not on the server. */
  z.object({ state: z.literal("desktop_only") }),
  /** The operator's entry is missing something (an env var); never names the value. */
  z.object({ message: z.string(), state: z.literal("unconfigured") }),
]);
export type ConnectorAvailability = z.infer<typeof connectorAvailabilitySchema>;

export const connectorSchema = z.object({
  auth: z.enum(["none", "header", "oauth"]),
  availability: connectorAvailabilitySchema,
  description: z.string().nullable(),
  /** The user's effective choice (or the operator's, when locked). */
  enabled: z.boolean(),
  id: libraryItemIdSchema,
  lock: connectorLockSchema.nullable(),
  /** The tool-name prefix the model sees. */
  name: z.string().min(1),
  /** `instance`: the operator's catalog; `library`: saved by the user or shared with them. */
  source: z.enum(["instance", "library"]),
  title: z.string().min(1),
  transport: z.enum(["http", "sse", "stdio"]),
});
export type Connector = z.infer<typeof connectorSchema>;

/** Whether, and where, users may add MCP servers of their own. */
export const userServerPolicySchema = z.object({
  allowed: z.boolean(),
  /** Host patterns (`example.com`, `*.example.com`); empty means any public host. */
  hosts: z.array(z.string()),
  transports: z.array(mcpTransportSchema),
});
export type UserServerPolicy = z.infer<typeof userServerPolicySchema>;

export const connectorListSchema = z.object({
  connectors: z.array(connectorSchema),
  userServers: userServerPolicySchema,
});
export type ConnectorList = z.infer<typeof connectorListSchema>;

export const setConnectorEnabledInputSchema = z.object({
  enabled: z.boolean(),
  id: libraryItemIdSchema,
});
export type SetConnectorEnabledInput = z.infer<
  typeof setConnectorEnabledInputSchema
>;

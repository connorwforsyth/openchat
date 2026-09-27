import type { FileId, UserId } from "@workspace/contract/schemas/common";
import type {
  AgentDefinition,
  LibraryDefinition,
  LibraryDefinitionInput,
  McpServerDefinition,
  PresetDefinition,
  PromptDefinition,
  SkillDefinition,
} from "@workspace/contract/schemas/library";
import type { Db } from "@workspace/db/client";
import { getReadableFile } from "@workspace/db/queries/files";
import type { SkillFileEntry } from "@workspace/db/queries/library-items";
import {
  MCP_HEADER_SECRET_AAD,
  type SealedSecret,
  seal,
} from "@workspace/mcp/crypto";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import type { Caller } from "./access";
import { type LibraryDeps, resolveItem } from "./core";
import { invalid, type LibraryError } from "./errors";

// Turning a definition from a request into what's stored. Two jobs: check
// every reference the caller adds (knowledge files, skill files, MCP
// servers, skills) is something they may use, so an agent can't become a
// way to read someone else's file; and seal MCP header secrets, which are
// write-only (D24).

/** The header secret to store: a new one, the one already stored, or none. */
export type SecretChange =
  | { readonly type: "set"; readonly sealed: SealedSecret }
  | { readonly type: "keep" }
  | { readonly type: "clear" };

export type PreparedDefinition =
  | { readonly definition: AgentDefinition; readonly kind: "agent" }
  | { readonly definition: PromptDefinition; readonly kind: "prompt" }
  | {
      readonly definition: Omit<SkillDefinition, "files">;
      readonly files: SkillFileEntry[];
      readonly kind: "skill";
    }
  | {
      readonly definition: McpServerDefinition;
      readonly kind: "mcp_server";
      readonly secret: SecretChange;
    }
  | { readonly definition: PresetDefinition; readonly kind: "preset" };

/** What's stored before this write, for "only check what's new" and secret keeping. */
export interface PreviousDefinition {
  readonly definition: LibraryDefinition | null;
  /** MCP servers: whether a header secret is stored. */
  readonly hasSecret?: boolean;
}

const newOnly = <T>(next: readonly T[], before: readonly T[]): T[] =>
  next.filter((each) => !before.includes(each));

const readableFiles = async (
  db: Db,
  caller: Caller,
  ids: readonly string[],
  path: readonly (number | string)[]
): AsyncResult<void, LibraryError> => {
  const viewer = { principals: caller.principals, userId: caller.userId };
  const checked = await Promise.all(
    ids.map((id) => getReadableFile(db, viewer, id as FileId))
  );
  const missing = checked.findIndex((each) => !each.ok);
  return missing < 0
    ? ok(undefined)
    : err(invalid("You can't attach that file.", [...path, missing]));
};

const usableItems = async (
  db: Db,
  userId: UserId,
  ids: readonly string[],
  kind: "mcp_server" | "skill",
  path: readonly (number | string)[]
): AsyncResult<void, LibraryError> => {
  for (const [index, id] of ids.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: a handful of references, checked in order so the first bad one is reported.
    const found = await resolveItem(db, userId, id as never, "use");
    if (!found.ok || found.value.kind !== kind) {
      return err(
        invalid(
          kind === "skill"
            ? "No such skill, or you can't use it."
            : "No such MCP server, or you can't use it.",
          [...path, index]
        )
      );
    }
  }
  return ok(undefined);
};

const agentBefore = (previous?: PreviousDefinition) =>
  previous?.definition?.kind === "agent" ? previous.definition : undefined;

const prepareAgent = async (
  deps: LibraryDeps,
  caller: Caller,
  definition: AgentDefinition,
  previous?: PreviousDefinition
): AsyncResult<PreparedDefinition, LibraryError> => {
  const before = agentBefore(previous);
  const files = await readableFiles(
    deps.db,
    caller,
    newOnly(definition.knowledgeFileIds, before?.knowledgeFileIds ?? []),
    ["definition", "knowledgeFileIds"]
  );
  if (!files.ok) {
    return files;
  }
  const servers = await usableItems(
    deps.db,
    caller.userId,
    newOnly(
      definition.mcpServers.map((server) => server.id),
      before?.mcpServers.map((server) => server.id) ?? []
    ),
    "mcp_server",
    ["definition", "mcpServers"]
  );
  if (!servers.ok) {
    return servers;
  }
  const skills = await usableItems(
    deps.db,
    caller.userId,
    newOnly(
      definition.skills.map((each) => each.id),
      before?.skills.map((each) => each.id) ?? []
    ),
    "skill",
    ["definition", "skills"]
  );
  return skills.ok ? ok({ definition, kind: "agent" }) : skills;
};

const prepareSkill = async (
  deps: LibraryDeps,
  caller: Caller,
  definition: SkillDefinition,
  previous?: PreviousDefinition
): AsyncResult<PreparedDefinition, LibraryError> => {
  const paths = definition.files.map((each) => each.path);
  const duplicate = paths.findIndex((path, i) => paths.indexOf(path) !== i);
  if (duplicate >= 0) {
    return err(
      invalid("Two files have the same path.", [
        "definition",
        "files",
        duplicate,
        "path",
      ])
    );
  }
  const before =
    previous?.definition?.kind === "skill"
      ? previous.definition.files.map((each) => each.fileId as string)
      : [];
  const files = await readableFiles(
    deps.db,
    caller,
    newOnly(
      definition.files.map((each) => each.fileId as string),
      before
    ),
    ["definition", "files"]
  );
  if (!files.ok) {
    return files;
  }
  const { files: entries, ...rest } = definition;
  return ok({
    definition: rest,
    files: entries.map((each) => ({ fileId: each.fileId, path: each.path })),
    kind: "skill",
  });
};

/**
 * The stored secret after this write. A new value is sealed; no value keeps
 * the old one only while the URL and header name stay the same, so an
 * editor can't point someone else's secret at a server of their choosing.
 */
const secretChange = (
  deps: LibraryDeps,
  input: Extract<LibraryDefinitionInput, { kind: "mcp_server" }>,
  previous?: PreviousDefinition
): { readonly change: SecretChange } | { readonly error: LibraryError } => {
  const { auth } = input;
  if (auth.type !== "header") {
    return { change: { type: "clear" } };
  }
  if (auth.value !== undefined) {
    if (!deps.keys.ok) {
      return {
        error: invalid(
          "Header secrets can't be stored until ENCRYPTION_KEY is set.",
          ["definition", "auth", "value"]
        ),
      };
    }
    return {
      change: {
        sealed: seal(deps.keys.value, auth.value, MCP_HEADER_SECRET_AAD),
        type: "set",
      },
    };
  }
  const before = previous?.definition;
  const unchanged =
    before?.kind === "mcp_server" &&
    before.url === input.url &&
    before.auth.type === "header" &&
    before.auth.headerName === auth.headerName;
  return {
    change:
      unchanged && previous?.hasSecret ? { type: "keep" } : { type: "clear" },
  };
};

/** Checks and normalises `input` for storage; `previous` is what's stored now, if anything. */
export const prepareDefinition = async (
  deps: LibraryDeps,
  caller: Caller,
  input: LibraryDefinitionInput,
  previous?: PreviousDefinition
): AsyncResult<PreparedDefinition, LibraryError> => {
  switch (input.kind) {
    case "agent":
      return await prepareAgent(deps, caller, input, previous);
    case "prompt":
      return ok({ definition: input, kind: "prompt" });
    case "skill":
      return await prepareSkill(deps, caller, input, previous);
    case "mcp_server": {
      const secret = secretChange(deps, input, previous);
      if ("error" in secret) {
        return err(secret.error);
      }
      const configured = secret.change.type !== "clear";
      const { auth } = input;
      return ok({
        definition: {
          auth:
            auth.type === "header"
              ? { configured, headerName: auth.headerName, type: "header" }
              : auth,
          kind: "mcp_server",
          transport: input.transport,
          url: input.url,
        },
        kind: "mcp_server",
        secret: secret.change,
      });
    }
    case "preset":
      return ok({ definition: input, kind: "preset" });
    default:
      return input satisfies never;
  }
};

/**
 * A stored definition as a create input: what duplicating, importing and
 * publishing copy. A header secret never travels this way.
 */
export const asInput = (
  definition: LibraryDefinition
): LibraryDefinitionInput =>
  definition.kind === "mcp_server" && definition.auth.type === "header"
    ? {
        ...definition,
        auth: { headerName: definition.auth.headerName, type: "header" },
      }
    : (definition as LibraryDefinitionInput);

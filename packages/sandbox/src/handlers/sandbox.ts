import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type {
  ExecInput,
  ExecResult,
  FileEntry,
  SandboxProvider,
  SandboxRecord,
  SandboxStatus,
} from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import {
  getConversation,
  type Viewer,
} from "@workspace/db/queries/conversations";
import {
  deleteSandbox,
  getSandbox,
  getSandboxForConversation,
  insertSandbox,
  type SandboxRow,
  toSandboxRecord,
  updateSandbox,
} from "@workspace/db/queries/sandboxes";
import { newId } from "@workspace/shared/ids";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import type { OutputChunk, Sandbox, SandboxError } from "../ports/sandbox";
import type {
  ProviderEntry,
  SandboxIsolation,
  SandboxProviders,
} from "../providers";
import { toBase64 } from "../runner/protocol";

// The contract's `sandbox` group as plain functions over `{ db, session,
// providers }` (D7); the API layer mounts them and maps errors to oRPC's
// typed errors. Access is the conversation's: anyone who can read the chat
// can see its sandbox and files, editors and the owner can create, run,
// reset and destroy. Provider failures never throw; a sandbox that couldn't
// start is stored as `failed` with a safe message.

export const sandboxHandlerErrorSchema = z.discriminatedUnion("type", [
  /** The conversation or sandbox doesn't exist or isn't visible (ids don't leak). */
  z.object({ type: z.literal("not_found") }),
  z.object({ type: z.literal("forbidden") }),
  /** → CONFLICT `already_exists`. */
  z.object({ type: z.literal("already_exists") }),
  /** → FEATURE_DISABLED: no sandbox providers on this instance. */
  z.object({ type: z.literal("feature_disabled") }),
  /** → VALIDATION: the input parses but can't be done (provider off, path outside, port unsupported). */
  z.object({ message: z.string(), type: z.literal("invalid") }),
  /** The provider can't be reached right now; the contract has no 503 for this group yet. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type SandboxHandlerError = z.infer<typeof sandboxHandlerErrorSchema>;

export interface SandboxHandlerDeps {
  readonly db: Db;
  /** The instance default (`sandbox.default`), when it's a configured provider. */
  readonly defaultProvider: SandboxProvider | null;
  readonly providers: SandboxProviders;
  readonly session: Viewer;
}

type Need = "read" | "write";

const fromSandboxError = (error: SandboxError): SandboxHandlerError => {
  switch (error.type) {
    case "not_found":
      return {
        message: `${error.path}: no such file or directory`,
        type: "invalid",
      };
    case "invalid_path":
      return {
        message: `${error.path} is outside the sandbox`,
        type: "invalid",
      };
    case "unsupported":
      return {
        message: `this sandbox doesn't support ${error.operation}`,
        type: "invalid",
      };
    case "limit_exceeded":
      return { message: error.message, type: "invalid" };
    case "destroyed":
      return { message: "the sandbox was destroyed", type: "unavailable" };
    case "unavailable":
      return { message: error.message, type: "unavailable" };
    default:
      return error satisfies never;
  }
};

type AccessDeps = Pick<SandboxHandlerDeps, "db" | "session">;

/** Checks the session may `need` the conversation. */
const authorize = async (
  { db, session }: AccessDeps,
  conversationId: ConversationId,
  need: Need
): AsyncResult<void, SandboxHandlerError> => {
  const conversation = await getConversation(db, conversationId, session);
  if (!conversation.ok) {
    return err({ type: "not_found" });
  }
  const permission = conversation.value.myPermission;
  if (need === "write" && permission !== "owner" && permission !== "editor") {
    return err({ type: "forbidden" });
  }
  return ok(undefined);
};

/** The sandbox row, if the session may `need` its conversation. */
const authorizedRow = async (
  deps: AccessDeps,
  id: SandboxId,
  need: Need
): AsyncResult<SandboxRow, SandboxHandlerError> => {
  const row = await getSandbox(deps.db, id);
  if (!row) {
    return err({ type: "not_found" });
  }
  const allowed = await authorize(deps, row.conversationId, need);
  return allowed.ok ? ok(row) : allowed;
};

/**
 * Whether the session may still run commands in the sandbox (an owner or
 * editor of its conversation), for work that runs later than the request
 * that asked for it, like the exec job.
 */
export const authorizeSandboxExec = async (
  deps: AccessDeps,
  id: SandboxId
): AsyncResult<void, SandboxHandlerError> => {
  const row = await authorizedRow(deps, id, "write");
  return row.ok ? ok(undefined) : row;
};

const entryFor = (
  deps: SandboxHandlerDeps,
  provider: SandboxProvider
): ProviderEntry | undefined => deps.providers.get(provider);

/** The live sandbox behind a row. */
const live = async (
  deps: SandboxHandlerDeps,
  row: SandboxRow
): AsyncResult<Sandbox, SandboxHandlerError> => {
  const entry = entryFor(deps, row.provider);
  if (!entry) {
    return err({
      message: `${row.provider} sandboxes are not configured on this instance`,
      type: "unavailable",
    });
  }
  const attached = await entry.factory.attach(row.id);
  return attached.ok ? attached : err(fromSandboxError(attached.error));
};

const isolationOf = async (
  provider: SandboxProvider,
  entry: ProviderEntry
): Promise<SandboxIsolation> => {
  const isolation = await entry.isolation();
  if (isolation.ok) {
    return isolation.value;
  }
  // A runner that's down can't say; assume the weaker isolation.
  return provider === "just-bash" ? "simulated" : "container";
};

/** Safe to show: fixed text, never the provider's own message. */
const startFailure = (error: SandboxError): string =>
  error.type === "unavailable"
    ? "The sandbox host is unavailable. Try again in a moment."
    : "The sandbox couldn't start.";

/** Starts the provider's sandbox for a row and records how that went. */
const start = async (
  deps: SandboxHandlerDeps,
  row: SandboxRow,
  entry: ProviderEntry
): Promise<SandboxRecord> => {
  const created = await entry.factory.create({
    conversationId: row.conversationId,
    id: row.id,
    limits: row.limits,
  });
  const status: SandboxStatus = created.ok
    ? { state: "ready" }
    : { message: startFailure(created.error), state: "failed" };
  const updated = await updateSandbox(deps.db, row.id, {
    isolation: await isolationOf(row.provider, entry),
    previews: [],
    snapshotRef: null,
    status,
  });
  return toSandboxRecord(updated ?? row);
};

export const getConversationSandbox = async (
  deps: SandboxHandlerDeps,
  input: { readonly conversationId: ConversationId }
): AsyncResult<SandboxRecord | null, SandboxHandlerError> => {
  const allowed = await authorize(deps, input.conversationId, "read");
  if (!allowed.ok) {
    return allowed;
  }
  const row = await getSandboxForConversation(deps.db, input.conversationId);
  if (!row) {
    return ok(null);
  }
  if (row.state !== "ready" && row.state !== "stopped") {
    return ok(toSandboxRecord(row));
  }
  // Refresh from the provider: the runner may have stopped it while idle.
  const sandbox = await live(deps, row);
  const status = sandbox.ok ? await sandbox.value.status() : undefined;
  if (status?.ok && status.value.state !== row.state) {
    const updated = await updateSandbox(deps.db, row.id, {
      status: status.value,
    });
    return ok(toSandboxRecord(updated ?? row));
  }
  return ok(toSandboxRecord(row));
};

export const createConversationSandbox = async (
  deps: SandboxHandlerDeps,
  input: {
    readonly conversationId: ConversationId;
    readonly provider?: SandboxProvider;
  }
): AsyncResult<SandboxRecord, SandboxHandlerError> => {
  const allowed = await authorize(deps, input.conversationId, "write");
  if (!allowed.ok) {
    return allowed;
  }
  if (deps.providers.size === 0) {
    return err({ type: "feature_disabled" });
  }
  const provider = input.provider ?? deps.defaultProvider;
  const entry = provider ? entryFor(deps, provider) : undefined;
  if (!(provider && entry)) {
    return err({
      message: `${provider ?? "the default"} sandbox provider isn't available on this instance`,
      type: "invalid",
    });
  }
  // The row claims the conversation's one slot before anything starts, so
  // two concurrent creates can't both start a sandbox.
  const row = await insertSandbox(deps.db, {
    conversationId: input.conversationId,
    id: newId("sandbox"),
    isolation: provider === "just-bash" ? "simulated" : "container",
    limits: entry.limits,
    provider,
    status: { state: "provisioning" },
  });
  if (!row) {
    return err({ type: "already_exists" });
  }
  return ok(await start(deps, row, entry));
};

export const resetSandbox = async (
  deps: SandboxHandlerDeps,
  input: { readonly id: SandboxId }
): AsyncResult<SandboxRecord, SandboxHandlerError> => {
  const row = await authorizedRow(deps, input.id, "write");
  if (!row.ok) {
    return row;
  }
  const entry = entryFor(deps, row.value.provider);
  if (!entry) {
    return err({
      message: `${row.value.provider} sandboxes are not configured on this instance`,
      type: "unavailable",
    });
  }
  const old = await entry.factory.attach(row.value.id);
  if (old.ok) {
    const destroyed = await old.value.destroy();
    if (!destroyed.ok && destroyed.error.type === "unavailable") {
      return err(fromSandboxError(destroyed.error));
    }
  }
  await updateSandbox(deps.db, row.value.id, {
    status: { state: "provisioning" },
  });
  return ok(await start(deps, row.value, entry));
};

export const destroySandbox = async (
  deps: SandboxHandlerDeps,
  input: { readonly id: SandboxId }
): AsyncResult<void, SandboxHandlerError> => {
  const row = await authorizedRow(deps, input.id, "write");
  if (!row.ok) {
    return row;
  }
  const sandbox = await live(deps, row.value);
  if (sandbox.ok) {
    const destroyed = await sandbox.value.destroy();
    // Keep the row while the provider still holds resources, so it can be retried.
    if (!destroyed.ok && destroyed.error.type === "unavailable") {
      return err(fromSandboxError(destroyed.error));
    }
  }
  await deleteSandbox(deps.db, row.value.id);
  return ok(undefined);
};

/** Runs a command and waits for it; `onOutput` streams it to the panel. */
export const execInSandbox = async (
  deps: SandboxHandlerDeps,
  input: ExecInput & { readonly id: SandboxId },
  options: {
    readonly onOutput?: (chunk: OutputChunk) => void;
    readonly signal?: AbortSignal;
  } = {}
): AsyncResult<ExecResult, SandboxHandlerError> => {
  const row = await authorizedRow(deps, input.id, "write");
  if (!row.ok) {
    return row;
  }
  const sandbox = await live(deps, row.value);
  if (!sandbox.ok) {
    return sandbox;
  }
  const result = await sandbox.value.exec(input.command, {
    cwd: input.cwd,
    env: input.env,
    onOutput: options.onOutput,
    signal: options.signal,
    timeoutMs: input.timeoutMs,
  });
  return result.ok ? result : err(fromSandboxError(result.error));
};

export const exposeSandboxPort = async (
  deps: SandboxHandlerDeps,
  input: { readonly id: SandboxId; readonly port: number }
): AsyncResult<{ port: number; url: string }, SandboxHandlerError> => {
  const row = await authorizedRow(deps, input.id, "write");
  if (!row.ok) {
    return row;
  }
  const sandbox = await live(deps, row.value);
  if (!sandbox.ok) {
    return sandbox;
  }
  const exposed = await sandbox.value.exposePort(input.port);
  if (!exposed.ok) {
    return err(fromSandboxError(exposed.error));
  }
  await updateSandbox(deps.db, row.value.id, {
    previews: [
      ...row.value.previews.filter((preview) => preview.port !== input.port),
      exposed.value,
    ].sort((a, b) => a.port - b.port),
  });
  return ok({ port: exposed.value.port, url: exposed.value.url });
};

export const listSandboxFiles = async (
  deps: SandboxHandlerDeps,
  input: {
    readonly id: SandboxId;
    readonly path: string;
    readonly recursive: boolean;
  }
): AsyncResult<FileEntry[], SandboxHandlerError> => {
  const row = await authorizedRow(deps, input.id, "read");
  if (!row.ok) {
    return row;
  }
  const sandbox = await live(deps, row.value);
  if (!sandbox.ok) {
    return sandbox;
  }
  const listed = await sandbox.value.listFiles(input.path, {
    recursive: input.recursive,
  });
  return listed.ok
    ? ok([...listed.value])
    : err(fromSandboxError(listed.error));
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

export const readSandboxFile = async (
  deps: SandboxHandlerDeps,
  input: { readonly id: SandboxId; readonly path: string }
): AsyncResult<
  { content: string; encoding: "utf8" | "base64"; path: string; size: number },
  SandboxHandlerError
> => {
  const row = await authorizedRow(deps, input.id, "read");
  if (!row.ok) {
    return row;
  }
  const sandbox = await live(deps, row.value);
  if (!sandbox.ok) {
    return sandbox;
  }
  const read = await sandbox.value.readFile(input.path);
  if (!read.ok) {
    return err(fromSandboxError(read.error));
  }
  const size = read.value.length;
  try {
    return ok({
      content: utf8.decode(read.value),
      encoding: "utf8",
      path: input.path,
      size,
    });
  } catch {
    return ok({
      content: toBase64(read.value),
      encoding: "base64",
      path: input.path,
      size,
    });
  }
};

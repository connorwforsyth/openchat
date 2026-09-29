import { createHash } from "node:crypto";

import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  type DeleteFileInput,
  type FileEntry,
  type ImportFileInput,
  SANDBOX_WRITE_MAX_BYTES,
  type SandboxFileEncoding,
  type SandboxFileWrite,
  type WriteFileInput,
} from "@workspace/contract/schemas/sandbox";
import { getReadableFile } from "@workspace/db/queries/files";
import type { Storage, StorageKey } from "@workspace/server/ports/storage";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { z } from "zod";

import { resolveSandboxPath, WORKDIR } from "../paths";
import type { Sandbox, SandboxError } from "../ports/sandbox";
import { previewStaticPage } from "../static-preview";
import {
  authorize,
  fromSandboxError,
  recordPreview,
  type SandboxHandlerDeps,
  sandboxHandlerErrorSchema,
} from "./sandbox";
import { ensureWorkspace, providerForTurn } from "./turn-tools";

// The Files panel's and composer's writes into a chat's workspace (055's
// `writeFile`, `importFile` and `deleteFile`), as plain functions the shell
// binds like the rest of the `sandbox` group. Each is keyed by conversation
// and creates the workspace on first use through `ensureWorkspace`, so a
// chat whose workspace failed to start is brought back by the first save,
// not by a Reset. Only the chat's owner and editors may change its files.
//
// Every path a person sends goes through `resolveWorkspacePath`: the agent
// may roam its sandbox, but these routes only ever touch `/work`.
//
// The version checks (`ifMatch`) read and then write, so two saves racing
// through the same instant can both pass; the etag guards against the far
// commoner case of a stale editor tab or an agent edit made since the read.

const MIB = 1024 * 1024;

/** just-bash keeps the workspace in memory, so people's files are held to less. */
export const JUST_BASH_FILE_MAX_BYTES = 10 * MIB;
export const JUST_BASH_WORKSPACE_MAX_BYTES = 50 * MIB;

/** Most filesystems' limit on one name. */
const NAME_MAX_BYTES = 255;
/** `notes (999).md` is the last free name an import tries. */
const MAX_COPIES = 999;
/** An upload whose name has nothing usable left is imported as this. */
const FALLBACK_NAME = "upload";
/** A longer "extension" is part of the name (`report.final-draft-v2`). */
const MAX_EXTENSION = 16;
/** Either slash: an upload's name may come from any operating system. */
const SLASHES = /[/\\]/;

export const workspaceFileErrorSchema = z.discriminatedUnion("type", [
  ...sandboxHandlerErrorSchema.options,
  /** → CONFLICT with this reason (`already_exists` is its own type above). */
  z.object({
    reason: z.enum(["version_mismatch", "not_empty"]),
    type: z.literal("conflict"),
  }),
]);
export type WorkspaceFileError = z.infer<typeof workspaceFileErrorSchema>;

export interface WorkspaceImportDeps extends SandboxHandlerDeps {
  /** Where uploads live (`files.upload`). */
  readonly storage: Storage;
  /** `limits.uploadMaxMb`: the largest upload an import copies. */
  readonly uploadMaxMb: number;
}

const invalid = (message: string) => err({ message, type: "invalid" as const });

const isControl = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
};

/**
 * `path` as an absolute path inside `/work`, or why it isn't one. Relative
 * paths resolve against `/work`; `..` may move around inside it but never
 * out; the workspace root itself isn't a file anyone can write or delete.
 * NUL and other control characters are refused outright, since no editor
 * or shell handles them in a name the same way.
 */
export const resolveWorkspacePath = (
  path: string
): Result<string, { readonly message: string; readonly type: "invalid" }> => {
  if (path.trim() === "") {
    return invalid("A path is required.");
  }
  if ([...path].some(isControl)) {
    return invalid("A path can't contain control characters.");
  }
  const resolved = resolveSandboxPath(path, WORKDIR);
  if (!(resolved.ok && resolved.value.startsWith(`${WORKDIR}/`))) {
    return invalid(`${path} is outside the workspace (${WORKDIR}).`);
  }
  return ok(resolved.value);
};

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;

/** `name` as a stem and an extension (`.md`), the extension possibly empty. */
const splitExtension = (name: string): readonly [string, string] => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= MAX_EXTENSION
    ? [name.slice(0, dot), name.slice(dot)]
    : [name, ""];
};

/** `stem + suffix + extension`, the stem shortened until it fits one name. */
const fitName = (stem: string, suffix: string, extension: string): string => {
  const room = NAME_MAX_BYTES - byteLength(suffix + extension);
  // A character is at least one byte, so this many is always enough to start from.
  const chars = [...stem].slice(0, Math.max(room, 0));
  while (chars.length > 0 && byteLength(chars.join("")) > room) {
    chars.pop();
  }
  return `${chars.join("").trimEnd() || FALLBACK_NAME}${suffix}${extension}`;
};

/**
 * An upload's name, safe as one workspace file name: no directories (either
 * slash), no control characters, not `.` or `..`, and short enough for a
 * filesystem, keeping its extension.
 */
export const cleanUploadName = (name: string): string => {
  const base = name.split(SLASHES).pop() ?? "";
  const printable = [...base]
    .filter((char) => !isControl(char))
    .join("")
    .trim();
  if (printable === "" || printable === "." || printable === "..") {
    return FALLBACK_NAME;
  }
  const [stem, extension] = splitExtension(printable);
  return fitName(stem, "", extension);
};

const parentOf = (path: string): string =>
  path.slice(0, path.lastIndexOf("/")) || "/";

const baseNameOf = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/** Hex SHA-256, as `readFile`'s etag is computed from the same bytes. */
const etagOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const decodeContent = (
  content: string,
  encoding: SandboxFileEncoding
): Uint8Array =>
  encoding === "base64"
    ? new Uint8Array(Buffer.from(content, "base64"))
    : encoder.encode(content);

const fromProvider = <T>(
  result: Result<T, SandboxError>
): Result<T, WorkspaceFileError> =>
  result.ok ? result : err(fromSandboxError(result.error));

/** The chat's workspace, started or brought back if it has to be. */
const workspaceFor = async (
  deps: SandboxHandlerDeps,
  conversationId: ConversationId
): AsyncResult<Sandbox, WorkspaceFileError> => {
  const wanted = providerForTurn(deps, "default");
  if (!wanted) {
    return err({ type: "feature_disabled" });
  }
  return fromProvider(
    await ensureWorkspace(deps, deps.session, conversationId, wanted)
  );
};

/** A page someone saved previews without a server (067); never fails the save. */
const previewPage = (
  deps: SandboxHandlerDeps,
  sandbox: Sandbox,
  path: string
): Promise<void> =>
  previewStaticPage(sandbox, path, {
    log: deps.log,
    record: (id, exposed) => recordPreview(deps.db, id, exposed),
  });

/**
 * What's at `path`, from its directory's listing: every provider lists a
 * directory, none stats a single path. `null` when nothing is there,
 * including when the directory itself isn't.
 */
const entryAt = async (
  sandbox: Sandbox,
  path: string
): AsyncResult<FileEntry | null, WorkspaceFileError> => {
  const listed = await sandbox.listFiles(parentOf(path));
  if (!listed.ok) {
    return listed.error.type === "not_found"
      ? ok(null)
      : err(fromSandboxError(listed.error));
  }
  return ok(listed.value.find((entry) => entry.path === path) ?? null);
};

/** just-bash's caps for writing `size` bytes to `path` (replacing what's there). */
const withinJustBashCaps = async (
  sandbox: Sandbox,
  path: string,
  size: number
): AsyncResult<void, WorkspaceFileError> => {
  if (sandbox.provider !== "just-bash") {
    return ok(undefined);
  }
  if (size > JUST_BASH_FILE_MAX_BYTES) {
    return invalid(
      `Files in this workspace can be up to ${JUST_BASH_FILE_MAX_BYTES / MIB} MB.`
    );
  }
  const listed = await sandbox.listFiles(WORKDIR, { recursive: true });
  if (!listed.ok) {
    return err(fromSandboxError(listed.error));
  }
  const others = listed.value
    .filter((entry) => entry.type === "file" && entry.path !== path)
    .reduce((total, entry) => total + (entry.size ?? 0), 0);
  return others + size > JUST_BASH_WORKSPACE_MAX_BYTES
    ? invalid(
        `This workspace holds up to ${JUST_BASH_WORKSPACE_MAX_BYTES / MIB} MB of files; delete some to make room.`
      )
    : ok(undefined);
};

/**
 * Writes `bytes` to `path` if `ifMatch` allows: omitted overwrites, `null`
 * only creates, an etag only replaces that version.
 */
const put = async (
  sandbox: Sandbox,
  path: string,
  bytes: Uint8Array,
  ifMatch: string | null | undefined
): AsyncResult<SandboxFileWrite, WorkspaceFileError> => {
  const entry = await entryAt(sandbox, path);
  if (!entry.ok) {
    return entry;
  }
  if (entry.value?.type === "directory") {
    return invalid(`${path} is a directory.`);
  }
  if (ifMatch === null && entry.value) {
    return err({ type: "already_exists" });
  }
  if (typeof ifMatch === "string") {
    const current = entry.value ? await sandbox.readFile(path) : null;
    if (current && !current.ok && current.error.type !== "not_found") {
      return err(fromSandboxError(current.error));
    }
    // Gone since it was read is a version too: the one the editor had isn't there.
    if (!current?.ok || etagOf(current.value) !== ifMatch) {
      return err({ reason: "version_mismatch", type: "conflict" });
    }
  }
  const capped = await withinJustBashCaps(sandbox, path, bytes.byteLength);
  if (!capped.ok) {
    return capped;
  }
  const written = await sandbox.writeFile(path, bytes);
  if (!written.ok) {
    return err(fromSandboxError(written.error));
  }
  return ok({ etag: etagOf(bytes), path, size: bytes.byteLength });
};

/** Writes a whole file into the chat's workspace, creating it first if needed. */
export const writeWorkspaceFile = async (
  deps: SandboxHandlerDeps,
  input: WriteFileInput
): AsyncResult<SandboxFileWrite, WorkspaceFileError> => {
  const allowed = await authorize(deps, input.conversationId, "write");
  if (!allowed.ok) {
    return allowed;
  }
  const path = resolveWorkspacePath(input.path);
  if (!path.ok) {
    return path;
  }
  const bytes = decodeContent(input.content, input.encoding);
  // The contract checks this too; handlers are also called without it.
  if (bytes.byteLength > SANDBOX_WRITE_MAX_BYTES) {
    return invalid(
      `Larger than ${SANDBOX_WRITE_MAX_BYTES} bytes; upload it and import it instead.`
    );
  }
  const sandbox = await workspaceFor(deps, input.conversationId);
  if (!sandbox.ok) {
    return sandbox;
  }
  const written = await put(sandbox.value, path.value, bytes, input.ifMatch);
  if (written.ok) {
    await previewPage(deps, sandbox.value, written.value.path);
  }
  return written;
};

/** `path`, or the first `name (n).ext` beside it that nothing has taken. */
const freePath = async (
  sandbox: Sandbox,
  path: string
): AsyncResult<string, WorkspaceFileError> => {
  const parent = parentOf(path);
  const listed = await sandbox.listFiles(parent);
  if (!(listed.ok || listed.error.type === "not_found")) {
    return err(fromSandboxError(listed.error));
  }
  const taken = new Set(listed.ok ? listed.value.map((e) => e.path) : []);
  if (!taken.has(path)) {
    return ok(path);
  }
  const [stem, extension] = splitExtension(baseNameOf(path));
  for (let copy = 2; copy <= MAX_COPIES; copy += 1) {
    const candidate = `${parent}/${fitName(stem, ` (${copy})`, extension)}`;
    if (!taken.has(candidate)) {
      return ok(candidate);
    }
  }
  return invalid(`There are too many copies of ${baseNameOf(path)} already.`);
};

type UploadRead =
  | { readonly bytes: Uint8Array; readonly type: "read" }
  | { readonly type: "missing" }
  | { readonly type: "too_large" };

/** An upload's bytes, giving up as soon as there are more than `max`. */
const readUpload = async (
  storage: Storage,
  key: StorageKey,
  max: number
): Promise<UploadRead> => {
  const object = await storage.get(key);
  if (!object.ok) {
    return { type: "missing" };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = object.value.body.getReader();
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: a stream is read in order.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return { type: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, type: "read" };
};

const tooLarge = (max: number) =>
  invalid(`Files imported into this workspace can be up to ${max / MIB} MB.`);

/**
 * Copies an upload the session may read into the chat's workspace: to
 * `path`, or under its cleaned name in `/work`, beside (never over) a file
 * already there.
 */
export const importWorkspaceFile = async (
  deps: WorkspaceImportDeps,
  input: ImportFileInput
): AsyncResult<SandboxFileWrite, WorkspaceFileError> => {
  const allowed = await authorize(deps, input.conversationId, "write");
  if (!allowed.ok) {
    return allowed;
  }
  const upload = await getReadableFile(deps.db, deps.session, input.fileId);
  if (!upload.ok) {
    return err({ type: "not_found" });
  }
  const target = resolveWorkspacePath(
    input.path ?? cleanUploadName(upload.value.name)
  );
  if (!target.ok) {
    return target;
  }
  const uploadMax = deps.uploadMaxMb * MIB;
  if (upload.value.size > uploadMax) {
    return tooLarge(uploadMax);
  }
  const sandbox = await workspaceFor(deps, input.conversationId);
  if (!sandbox.ok) {
    return sandbox;
  }
  const max =
    sandbox.value.provider === "just-bash"
      ? Math.min(uploadMax, JUST_BASH_FILE_MAX_BYTES)
      : uploadMax;
  if (upload.value.size > max) {
    return tooLarge(max);
  }
  // The row's size is what the uploader declared; the bytes are what count.
  const read = await readUpload(deps.storage, upload.value.storageKey, max);
  if (read.type === "missing") {
    return invalid("That upload's contents aren't available.");
  }
  if (read.type === "too_large") {
    return tooLarge(max);
  }
  const path = await freePath(sandbox.value, target.value);
  if (!path.ok) {
    return path;
  }
  const written = await put(sandbox.value, path.value, read.bytes, null);
  if (written.ok) {
    await previewPage(deps, sandbox.value, written.value.path);
  }
  return written;
};

/** Quotes one argument for a POSIX shell. */
const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Deletes a file, or a directory that's empty or `recursive` allows, from
 * the chat's workspace. `--` ends the options, so a name starting with `-`
 * is only ever a name.
 */
export const deleteWorkspaceFile = async (
  deps: SandboxHandlerDeps,
  input: DeleteFileInput
): AsyncResult<void, WorkspaceFileError> => {
  const allowed = await authorize(deps, input.conversationId, "write");
  if (!allowed.ok) {
    return allowed;
  }
  const path = resolveWorkspacePath(input.path);
  if (!path.ok) {
    return path;
  }
  const sandbox = await workspaceFor(deps, input.conversationId);
  if (!sandbox.ok) {
    return sandbox;
  }
  const entry = await entryAt(sandbox.value, path.value);
  if (!entry.ok) {
    return entry;
  }
  if (!entry.value) {
    return invalid(`${input.path}: no such file or directory`);
  }
  const isDirectory = entry.value.type === "directory";
  if (isDirectory && !input.recursive) {
    const inside = await sandbox.value.listFiles(path.value);
    if (!inside.ok) {
      return err(fromSandboxError(inside.error));
    }
    if (inside.value.length > 0) {
      return err({ reason: "not_empty", type: "conflict" });
    }
  }
  // An empty directory needs `-r` too; the check above is what guards a full one.
  const command = `rm ${isDirectory ? "-r " : ""}-- ${shellQuote(path.value)}`;
  const ran = await sandbox.value.exec(command);
  if (!ran.ok) {
    return err(fromSandboxError(ran.error));
  }
  if (ran.value.exitCode !== 0) {
    const [reason] = ran.value.stderr.trim().split("\n");
    return invalid(
      reason
        ? `Couldn't delete ${input.path}: ${reason}`
        : `Couldn't delete ${input.path}.`
    );
  }
  return ok(undefined);
};

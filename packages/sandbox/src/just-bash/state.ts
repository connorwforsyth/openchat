import { err, ok, type Result, tryCatch } from "@workspace/shared/result";
import type { IFileSystem } from "just-bash";
import { z } from "zod";

import { WORKDIR } from "../paths";
import type { SandboxError } from "../ports/sandbox";

// A just-bash workspace as data: every entry under the workdir, with file
// bytes in base64. Only the workdir is kept; `/bin` stubs and `/tmp` are
// rebuilt by just-bash itself, like a fresh boot.

const entrySchema = z.discriminatedUnion("type", [
  z.object({
    content: z.base64(),
    mode: z.int().min(0),
    mtime: z.int().min(0),
    path: z.string().min(1),
    type: z.literal("file"),
  }),
  z.object({
    mode: z.int().min(0),
    path: z.string().min(1),
    type: z.literal("directory"),
  }),
  z.object({
    path: z.string().min(1),
    target: z.string(),
    type: z.literal("symlink"),
  }),
]);

export const workspaceStateSchema = z.object({
  entries: z.array(entrySchema),
  version: z.literal(1),
});
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

const inWorkdir = (path: string) =>
  path === WORKDIR || path.startsWith(`${WORKDIR}/`);

/** Reads the workdir of `fs` into a serialisable state. */
export const captureWorkspace = async (
  fs: IFileSystem
): Promise<WorkspaceState> => {
  const entries: WorkspaceState["entries"] = [];
  const paths = fs
    .getAllPaths()
    .filter((path) => inWorkdir(path) && path !== WORKDIR)
    .sort();
  for (const path of paths) {
    // biome-ignore lint/performance/noAwaitInLoops: an in-memory filesystem; order keeps the state sorted.
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink) {
      entries.push({ path, target: await fs.readlink(path), type: "symlink" });
    } else if (stat.isDirectory) {
      entries.push({ mode: stat.mode, path, type: "directory" });
    } else {
      entries.push({
        content: toBase64(await fs.readFileBuffer(path)),
        mode: stat.mode,
        mtime: stat.mtime.getTime(),
        path,
        type: "file",
      });
    }
  }
  return { entries, version: 1 };
};

const restoreEntry = async (
  fs: IFileSystem,
  entry: WorkspaceState["entries"][number]
): Promise<void> => {
  switch (entry.type) {
    case "directory":
      await fs.mkdir(entry.path, { recursive: true });
      return fs.chmod(entry.path, entry.mode);
    case "file":
      await fs.writeFile(entry.path, fromBase64(entry.content));
      await fs.chmod(entry.path, entry.mode);
      return fs.utimes(entry.path, new Date(), new Date(entry.mtime));
    case "symlink":
      return fs.symlink(entry.target, entry.path);
    default:
      return entry satisfies never;
  }
};

/** Writes a captured state into `fs`, which should be empty. */
export const restoreWorkspace = async (
  fs: IFileSystem,
  state: WorkspaceState
): Promise<void> => {
  await fs.mkdir(WORKDIR, { recursive: true });
  for (const entry of state.entries) {
    if (inWorkdir(entry.path)) {
      // biome-ignore lint/performance/noAwaitInLoops: sorted paths put every directory before its contents.
      await restoreEntry(fs, entry);
    }
  }
};

export const encodeState = (state: WorkspaceState): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(state));

/** Parses stored bytes; a corrupt or foreign blob is an error, never a throw. */
export const decodeState = (
  bytes: Uint8Array
): Result<WorkspaceState, SandboxError> => {
  const json = tryCatch(
    () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    () => undefined
  );
  if (!json.ok) {
    return err({
      message: "the saved workspace is corrupt",
      type: "unavailable",
    });
  }
  const parsed = workspaceStateSchema.safeParse(json.value);
  return parsed.success
    ? ok(parsed.data)
    : err({ message: "the saved workspace is corrupt", type: "unavailable" });
};

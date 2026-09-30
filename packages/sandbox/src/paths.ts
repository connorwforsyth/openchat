import { err, ok, type Result } from "@workspace/shared/result";

import type { SandboxError } from "./ports/sandbox";

// Every provider resolves paths the same way, so a relative path the agent
// uses in `read` names the same file `bash` sees: POSIX, relative to the
// workdir, and never above `/`. That is the providers' rule, loose enough
// for internal writes outside the workspace (the static preview's server
// lives in $HOME). Paths that come from a person or from the agent's file
// tools go through the stricter `resolveWorkspacePath` first (D7).

/** Where every provider mounts the sandbox's own files. */
export const WORKDIR = "/work";

/** Resolves `path` against `cwd`, refusing to climb out of `/`. */
export const resolveSandboxPath = (
  path: string,
  cwd = WORKDIR
): Result<string, SandboxError> => {
  if (path.includes("\0")) {
    return err({ path, type: "invalid_path" });
  }
  const segments: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split(
    "/"
  )) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length === 0) {
        return err({ path, type: "invalid_path" });
      }
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return ok(`/${segments.join("/")}`);
};

/** C0 and C1 control characters, NUL and newlines among them. */
export const isControlCharacter = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
};

export interface WorkspacePathError {
  readonly message: string;
  readonly type: "invalid";
}

const invalid = (message: string) =>
  err<WorkspacePathError>({ message, type: "invalid" });

/**
 * `path` as an absolute path inside `/work`, or why it isn't one. Relative
 * paths resolve against `/work`; `..` may move around inside it but never
 * out; the workspace root itself isn't a file anyone can write or delete.
 * NUL and other control characters are refused outright, since no editor
 * or shell handles them in a name the same way.
 */
export const resolveWorkspacePath = (
  path: string
): Result<string, WorkspacePathError> => {
  if (path.trim() === "") {
    return invalid("A path is required.");
  }
  if ([...path].some(isControlCharacter)) {
    return invalid("A path can't contain control characters.");
  }
  const resolved = resolveSandboxPath(path, WORKDIR);
  if (!(resolved.ok && resolved.value.startsWith(`${WORKDIR}/`))) {
    return invalid(`${path} is outside the workspace (${WORKDIR}).`);
  }
  return ok(resolved.value);
};

import { err, ok, type Result } from "@workspace/shared/result";

import type { SandboxError } from "./ports/sandbox";

// Every provider resolves paths the same way, so a relative path the agent
// uses in `read` names the same file `bash` sees: POSIX, relative to the
// workdir, and never above `/`.

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

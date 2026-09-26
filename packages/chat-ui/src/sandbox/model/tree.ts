import type { FileEntry } from "@workspace/contract/schemas/sandbox";

// Sandbox listings are absolute (`/work/src/a.ts`); the file tree wants paths
// relative to the workspace, with directories ending in `/`.

export const SANDBOX_ROOT = "/work";

const TRAILING_SLASHES = /\/+$/;

/** Paths for `FileTree`, sorted, relative to `root`; entries outside it are dropped. */
export const toTreePaths = (
  entries: readonly FileEntry[],
  root = SANDBOX_ROOT
): string[] => {
  const prefix = `${root.replace(TRAILING_SLASHES, "")}/`;
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) {
      continue;
    }
    const relative = entry.path.slice(prefix.length);
    if (!relative) {
      continue;
    }
    paths.add(entry.type === "directory" ? `${relative}/` : relative);
  }
  return [...paths].sort();
};

/** The absolute path of a tree path, for `readFile`. */
export const toSandboxPath = (treePath: string, root = SANDBOX_ROOT): string =>
  `${root.replace(TRAILING_SLASHES, "")}/${treePath.replace(TRAILING_SLASHES, "")}`;

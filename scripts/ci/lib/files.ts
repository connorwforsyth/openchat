// The guards' I/O: listing and reading files. Kept apart from the pure rules
// so tests can feed them fixtures.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { err, ok, type Result } from "./result";
import type { SourceFile } from "./violation";

const toPosix = (path: string): string => path.split(sep).join("/");

const git = (root: string, args: readonly string[]): Result<string, string> => {
  try {
    return ok(
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
    );
  } catch (error) {
    return err(`git ${args.join(" ")} failed: ${String(error)}`);
  }
};

/** Tracked files plus new files that aren't ignored, so a local run sees unstaged work. */
export const listGitFiles = (root: string): Result<string[], string> => {
  const listed = git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (!listed.ok) {
    return listed;
  }
  // Files deleted in the working tree are still "cached"; skip them.
  const paths = listed.value
    .split("\0")
    .filter((path) => path !== "" && existsSync(join(root, path)));
  return ok([...new Set(paths)]);
};

/** Paths `git status` reports as changed or new, for drift checks after a codegen step. */
export const listChangedFiles = (
  root: string,
  pathspec: readonly string[]
): Result<string[], string> => {
  const status = git(root, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--",
    ...pathspec,
  ]);
  if (!status.ok) {
    return status;
  }
  // Each -z record is "XY path"; renames carry a second NUL-separated path we don't need.
  return ok(
    status.value
      .split("\0")
      .filter((record) => record.length > 3 && record[2] === " ")
      .map((record) => record.slice(3))
  );
};

/** Every file under `root`, for running a guard over a fixture tree outside git. */
export const walkFiles = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => toPosix(relative(root, join(entry.parentPath, entry.name))))
    .sort();

const isBinary = (buffer: Buffer): boolean => buffer.includes(0);

export const readSourceFiles = (
  root: string,
  paths: readonly string[]
): SourceFile[] =>
  paths.flatMap((path) => {
    const absolute = join(root, path);
    if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
      return [];
    }
    const buffer = readFileSync(absolute);
    return isBinary(buffer) ? [] : [{ content: buffer.toString("utf8"), path }];
  });

export const readOptional = (path: string): string =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

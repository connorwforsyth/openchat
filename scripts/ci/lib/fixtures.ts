// Test helper: a fixture tree under __fixtures__/<guard>/<variant>, read the
// same way the CLI reads the repo.
import { fileURLToPath } from "node:url";
import { readSourceFiles, walkFiles } from "./files";
import type { SourceFile } from "./violation";

export const fixtureRoot = (guard: string, variant: "bad" | "good"): string =>
  fileURLToPath(
    new URL(`../__fixtures__/${guard}/${variant}`, import.meta.url)
  );

export const loadFixture = (
  guard: string,
  variant: "bad" | "good"
): SourceFile[] => {
  const root = fixtureRoot(guard, variant);
  return readSourceFiles(root, walkFiles(root));
};

/** `path:line` pairs: enough to pin each violation without restating messages. */
export const locations = (
  violations: readonly { path: string; line: number }[]
): string[] => violations.map(({ path, line }) => `${path}:${line}`);

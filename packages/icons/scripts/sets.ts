import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { IconPlatform, IconSetId } from "../src/set-ids";
import { exportedIconNames } from "./registry";

// The imperative shell shared by the CLI scripts: find and read set files.

export const srcDir = join(import.meta.dirname, "..", "src");

const extensions = [".ts", ".tsx"];

function findFile(specifier: string): string | undefined {
  return extensions
    .map((extension) => join(srcDir, `${specifier}${extension}`))
    .find((file) => existsSync(file));
}

/**
 * `./sets/<id>[.native]` (an import specifier relative to `src/`) if that set
 * is implemented for the platform.
 */
export function setFile(
  setId: IconSetId,
  platform: IconPlatform
): string | undefined {
  const suffix = platform === "native" ? ".native" : "";
  const specifier = `./sets/${setId}${suffix}`;
  return findFile(specifier) ? specifier : undefined;
}

export function availableNames(
  specifier: string | undefined
): ReadonlySet<string> | undefined {
  const file = specifier && findFile(specifier);
  if (!file) {
    return;
  }
  return new Set(exportedIconNames(readFileSync(file, "utf8")));
}

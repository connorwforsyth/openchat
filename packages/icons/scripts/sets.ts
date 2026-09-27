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

/** The source of `./sets/<id>[.native]`, if it exists. */
export function setSource(specifier: string | undefined): string | undefined {
  const file = specifier && findFile(specifier);
  return file ? readFileSync(file, "utf8") : undefined;
}

export function availableNames(
  specifier: string | undefined
): ReadonlySet<string> | undefined {
  const source = setSource(specifier);
  return source === undefined ? undefined : new Set(exportedIconNames(source));
}

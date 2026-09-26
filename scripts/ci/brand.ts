// Guard: the codename is a working name (PLAN.md D18), so it may only appear
// where a rename is a one-line change: the brand block, the root package name
// and image names, plus the planning docs that record history.
import { isFixture } from "./lib/paths";
import type { SourceFile, Violation } from "./lib/violation";

// Assembled from parts so this file doesn't trip the check it implements.
export const BRAND = ["open", "chat"].join("");

const EXEMPT_FILES = new Set(["PLAN.md", "bun.lock"]);
// Research notes and decision records are dated history, not product surface.
const EXEMPT_DIRS = [".wayfinder/", ".github/", ".context/", "docs/decisions/"];

const APP_CONFIG = /(?:^|\/)app\.config(?:\.example)?\.ya?ml$/;
const COMPOSE_FILE = /(?:^|\/)(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/;
const PACKAGE_NAME_LINE = /^\s*"name"\s*:/;
const IMAGE_LINE = /^\s*(?:image|container_name)\s*:/;
const BRAND_BLOCK_START = /^brand\s*:/;
const TOP_LEVEL_KEY = /^[^\s#]/;

const needle = new RegExp(BRAND, "gi");

export const isBrandChecked = (path: string): boolean =>
  !(
    EXEMPT_FILES.has(path) ||
    EXEMPT_DIRS.some((dir) => path.startsWith(dir)) ||
    isFixture(path)
  );

/** Indexes of the lines in the top-level `brand:` block of a YAML file. */
const brandBlockLines = (lines: readonly string[]): ReadonlySet<number> => {
  const inside = new Set<number>();
  let inBlock = false;
  for (const [index, line] of lines.entries()) {
    if (BRAND_BLOCK_START.test(line)) {
      inBlock = true;
    } else if (TOP_LEVEL_KEY.test(line)) {
      inBlock = false;
    }
    if (inBlock) {
      inside.add(index);
    }
  }
  return inside;
};

/** Which lines of this file may carry the name. */
const exemptLine = (
  path: string,
  lines: readonly string[]
): ((index: number) => boolean) => {
  if (path === "package.json") {
    return (index) => PACKAGE_NAME_LINE.test(lines[index] ?? "");
  }
  if (APP_CONFIG.test(path)) {
    const block = brandBlockLines(lines);
    return (index) => block.has(index);
  }
  if (COMPOSE_FILE.test(path)) {
    return (index) => IMAGE_LINE.test(lines[index] ?? "");
  }
  return () => false;
};

const checkFile = (file: SourceFile): Violation[] => {
  const lines = file.content.split("\n");
  const exempt = exemptLine(file.path, lines);
  return lines.flatMap((line, index) =>
    exempt(index)
      ? []
      : [...line.matchAll(needle)].map((match) => ({
          column: match.index + 1,
          line: index + 1,
          message: `"${match[0]}" outside the brand block: read the name from app.config.yaml \`brand\` instead (PLAN.md D18)`,
          path: file.path,
        }))
  );
};

export const checkBrand = (files: readonly SourceFile[]): Violation[] =>
  files.filter((file) => isBrandChecked(file.path)).flatMap(checkFile);

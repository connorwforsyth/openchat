// Path rules shared by the guards. Everything here is pure.

// Fixtures deliberately break the rules the guards enforce.
export const FIXTURES_DIR = "scripts/ci/__fixtures__/";

const GENERATED_SEGMENTS = new Set([
  ".next",
  ".turbo",
  "__generated__",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "vendor",
]);

const CODE_FILE = /\.[cm]?[jt]sx?$/;

export const isFixture = (path: string): boolean =>
  path.startsWith(FIXTURES_DIR);

export const isGenerated = (path: string): boolean =>
  path.split("/").some((segment) => GENERATED_SEGMENTS.has(segment));

export const isCodeFile = (path: string): boolean => CODE_FILE.test(path);

/** Product source: anything under `apps/` or `packages/` that a human wrote. */
export const isProductSource = (path: string): boolean =>
  (path.startsWith("apps/") || path.startsWith("packages/")) &&
  !isGenerated(path);

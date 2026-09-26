// Guard: icons come from `@workspace/icons` only (PLAN.md D19), so the icon set
// is swappable from config. Only `packages/icons` may import an icon library.
import { isCodeFile, isProductSource } from "./lib/paths";
import { positionAt, type SourceFile, type Violation } from "./lib/violation";

export const ALLOWLIST_PATH = "scripts/ci/icon-imports.allow";

const ICONS_PACKAGE = "packages/icons/";

const BANNED_MODULES: readonly RegExp[] = [
  /^lucide-react(?:-native)?(?:\/|$)/,
  /^@phosphor-icons\//,
  /^@tabler\/icons-react(?:-native)?(?:\/|$)/,
  /^hugeicons-react(?:\/|$)/,
  /^@hugeicons\//,
  /^@remixicon\//,
  /^@material-symbols\//,
];

// Static and dynamic imports, re-exports, `require` and test mocks. Multi-line
// imports still end in `from "x"`, so matching the specifier is enough.
const MODULE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bmock\s*\(\s*)(["'])([^"'\n]+)\1/g;

const COMMENT = /#.*$/;

export const isIconChecked = (path: string): boolean =>
  isProductSource(path) && isCodeFile(path) && !path.startsWith(ICONS_PACKAGE);

/** One repo-relative path per line; `#` starts a comment. */
export const parseAllowlist = (
  content: string
): readonly { path: string; line: number }[] =>
  content.split("\n").flatMap((raw, index) => {
    const path = raw.replace(COMMENT, "").trim();
    return path ? [{ line: index + 1, path }] : [];
  });

const findBannedImports = (file: SourceFile): Violation[] =>
  [...file.content.matchAll(MODULE_SPECIFIER)].flatMap((match) => {
    const specifier = match[2] ?? "";
    if (!BANNED_MODULES.some((banned) => banned.test(specifier))) {
      return [];
    }
    const { line, column } = positionAt(file.content, match.index);
    return [
      {
        column,
        line,
        message: `imports "${specifier}" directly: import icons from "@workspace/icons"`,
        path: file.path,
      },
    ];
  });

export const checkIconImports = (
  files: readonly SourceFile[],
  allowlist = ""
): Violation[] => {
  const allowed = parseAllowlist(allowlist);
  const allowedPaths = new Set(allowed.map((entry) => entry.path));
  const offenders = files
    .filter((file) => isIconChecked(file.path))
    .map((file) => ({ file, violations: findBannedImports(file) }))
    .filter(({ violations }) => violations.length > 0);
  const offendingPaths = new Set(offenders.map(({ file }) => file.path));

  // A stale entry fails too, so the allowlist only ever shrinks.
  const stale: Violation[] = allowed
    .filter((entry) => !offendingPaths.has(entry.path))
    .map((entry) => ({
      column: 1,
      line: entry.line,
      message: `"${entry.path}" no longer imports an icon library: remove it from the allowlist`,
      path: ALLOWLIST_PATH,
    }));

  return [
    ...offenders
      .filter(({ file }) => !allowedPaths.has(file.path))
      .flatMap(({ violations }) => violations),
    ...stale,
  ];
};

// Guard: colours come from semantic tokens only (PLAN.md D5). The theme lives
// in one file; everything else says `bg-background`, never `#fff` or `bg-zinc-50`.
import { isProductSource } from "./lib/paths";
import { positionAt, type SourceFile, type Violation } from "./lib/violation";

export const TOKEN_SOURCE = "packages/ui/src/styles/globals.css";

// The escape hatch for a genuine false positive (a URL fragment like `#feed`).
// Applies to its own line and the next one; say why next to it.
export const IGNORE_MARKER = "ci-guard-ignore tokens";

const SCANNED_FILE = /\.(?:[cm]?[jt]sx?|css)$/;

// Tailwind's palette, including the neutrals added in v4.2.
const PALETTE =
  "slate|gray|zinc|neutral|stone|taupe|mauve|mist|olive|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const SHADE = "50|[1-9]00|950";
const COLOUR_UTILITIES =
  "bg|text|border(?:-[xytrblse])?|outline|ring(?:-offset)?|inset-ring|shadow|inset-shadow|drop-shadow|text-shadow|divide|fill|stroke|from|via|to|decoration|placeholder|caret|accent";

const RULES: readonly {
  pattern: RegExp;
  describe: (match: string) => string;
}[] = [
  {
    // `&` skips HTML entities (`&#123;`), `.` skips `this.#private` fields.
    describe: (match) => `raw hex colour "${match}"`,
    pattern: /(?<![\w&.])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])/gi,
  },
  {
    describe: (match) => `raw colour function "${match}…)"`,
    pattern: /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi,
  },
  {
    describe: (match) => `Tailwind palette class "${match}"`,
    pattern: new RegExp(
      `(?<![\\w-])(?:${COLOUR_UTILITIES})-(?:(?:${PALETTE})-(?:${SHADE})|black|white)(?![\\w-])`,
      "g"
    ),
  },
  {
    describe: (match) => `Tailwind palette variable "${match}"`,
    pattern: new RegExp(
      `--color-(?:(?:${PALETTE})-(?:${SHADE})|black|white)(?![\\w-])`,
      "g"
    ),
  },
];

const HINT =
  "use a semantic token from @workspace/ui (bg-background, text-muted-foreground, …)";

export const isTokenChecked = (path: string): boolean =>
  isProductSource(path) && SCANNED_FILE.test(path) && path !== TOKEN_SOURCE;

/**
 * Line ranges to skip: whole-line `//` comments, `/* … *\/` blocks that start a
 * line, and lines covered by the ignore marker. Comments cite issue numbers
 * (`#450`) that look like hex, and a comment can't colour anything.
 */
const skippedLines = (lines: readonly string[]): ReadonlySet<number> => {
  const skipped = new Set<number>();
  let inBlock = false;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (raw.includes(IGNORE_MARKER)) {
      skipped.add(index);
      skipped.add(index + 1);
    }
    if (inBlock || line.startsWith("//")) {
      skipped.add(index);
    } else if (line.startsWith("/*")) {
      skipped.add(index);
      inBlock = true;
    }
    if (inBlock && line.includes("*/")) {
      inBlock = false;
    }
  }
  return skipped;
};

export const checkTokens = (files: readonly SourceFile[]): Violation[] =>
  files.filter((file) => isTokenChecked(file.path)).flatMap(checkFile);

const checkFile = (file: SourceFile): Violation[] => {
  const skipped = skippedLines(file.content.split("\n"));
  return RULES.flatMap(({ pattern, describe }) =>
    [...file.content.matchAll(pattern)].flatMap((match) => {
      const { line, column } = positionAt(file.content, match.index);
      return skipped.has(line - 1)
        ? []
        : [
            {
              column,
              line,
              message: `${describe(match[0])}: ${HINT}`,
              path: file.path,
            },
          ];
    })
  ).sort((a, b) => a.line - b.line || a.column - b.column);
};

// Guard: shared components animate only transform and opacity (PLAN.md D28,
// AGENTS.md "Motion"). Layout properties (height, width, margins, insets)
// make the browser lay out every frame, and `transition: all` quietly picks
// them up. Colour transitions are fine; they don't move anything.
import { isProductSource } from "./lib/paths";
import { positionAt, type SourceFile, type Violation } from "./lib/violation";

/** Where the rule is enforced: the shared components everything builds on. */
export const MOTION_SCOPE = ["packages/ui/src/"] as const;

// For a genuine false positive; applies to its own line and the next.
export const IGNORE_MARKER = "ci-guard-ignore motion";

const SCANNED_FILE = /\.(?:[cm]?[jt]sx?|css)$/;

// Properties that trigger layout when they change.
const LAYOUT_PROPERTY =
  /^(?:all|height|width|(?:min|max)-(?:height|width)|block-size|inline-size|(?:min|max)-(?:block|inline)-size|top|right|bottom|left|inset(?:-[\w-]+)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|flex-basis|grid-template-(?:rows|columns))$/;

const ENTRY_SEPARATOR = /[\s_]+/;

const HINT =
  "animate only transform and opacity (D28); open and close instantly or use a transform/opacity reveal";

interface Finding {
  readonly index: number;
  readonly message: string;
}

/** `transition-all`, and Tailwind's height keyframes (`animate-accordion-down`, …). */
const utilityFindings = (content: string): Finding[] =>
  [
    ...content.matchAll(
      /(?<![\w-])(?:transition-all|animate-(?:height|(?:accordion|collapsible)-(?:down|up)))(?![\w-])/g
    ),
  ].map((match) => ({ index: match.index, message: `"${match[0]}"` }));

/** `transition-[height,opacity]`: each listed property. */
const arbitraryFindings = (content: string): Finding[] =>
  [...content.matchAll(/(?<![\w-])transition-\[([^\]]*)\]/g)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((property) => property.trim())
      .filter((property) => LAYOUT_PROPERTY.test(property))
      .map((property) => ({
        index: match.index,
        message: `"${match[0]}" transitions ${property}`,
      }))
  );

/**
 * `transition: height 200ms`, `transition-property: width`, a style object's
 * `transition: "all 1s"` and Tailwind's `[transition:transform_1s,height_1s]`:
 * the first word of each comma-separated entry is the property.
 */
const declarationFindings = (content: string): Finding[] =>
  [
    ...content.matchAll(
      /(?<![\w-])transition(?:-?[pP]roperty)?\s*:\s*["'`]?([^;{}\]"'`]*)/g
    ),
  ].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((entry) => entry.trim().split(ENTRY_SEPARATOR)[0] ?? "")
      .filter((property) => LAYOUT_PROPERTY.test(property))
      .map((property) => ({
        index: match.index,
        message: `a transition on ${property}`,
      }))
  );

export const isMotionChecked = (path: string): boolean =>
  isProductSource(path) &&
  SCANNED_FILE.test(path) &&
  MOTION_SCOPE.some((prefix) => path.startsWith(prefix));

/** Whole-line comments and ignore-marked lines, as in the tokens guard. */
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

const checkFile = (file: SourceFile): Violation[] => {
  const skipped = skippedLines(file.content.split("\n"));
  return [
    ...utilityFindings(file.content),
    ...arbitraryFindings(file.content),
    ...declarationFindings(file.content),
  ]
    .flatMap(({ index, message }) => {
      const { line, column } = positionAt(file.content, index);
      return skipped.has(line - 1)
        ? []
        : [{ column, line, message: `${message}: ${HINT}`, path: file.path }];
    })
    .sort((a, b) => a.line - b.line || a.column - b.column);
};

export const checkMotion = (files: readonly SourceFile[]): Violation[] =>
  files.filter((file) => isMotionChecked(file.path)).flatMap(checkFile);

// Turns the Markdown in this folder into `generated.ts`, the module the
// rest of the code imports. Nothing reads a `.md` file at run time: Next,
// Vitest, Evalite, bun and (later) the desktop and mobile bundles all take
// plain TypeScript, and none of them agree on how to import raw text.
//
// Everything here is pure; `scripts/generate-prompts.ts` does the reading
// and writing, and `generated.test.ts` fails when the checked-in module no
// longer matches the Markdown.

/** A prompt file as it's bundled: where it came from, and its text. */
export interface PromptFile {
  /** Relative to `src/prompts`, such as `base/10-identity.md`. */
  readonly source: string;
  readonly text: string;
}

/** A prompt file split into named parts by `<!-- part: name -->` lines. */
export interface PromptParts {
  readonly parts: Readonly<Record<string, string>>;
  readonly source: string;
}

export interface PromptBundle {
  /** `base/NN-*.md`, in filename order. */
  readonly base: readonly PromptFile[];
  /** `fragments/*.md`, by filename without the extension. */
  readonly fragments: Readonly<Record<string, PromptFile | PromptParts>>;
}

const BASE_FILE = /^base\/\d\d-[a-z][a-z0-9-]*\.md$/;
const FRAGMENT_FILE = /^fragments\/([a-z][a-z0-9-]*)\.md$/;
const PART_MARKER = /^<!-- part: ([a-zA-Z][a-zA-Z0-9]*) -->$/;
const LINE_BREAK = /\r\n?/g;
const OUTER_LINE_BREAKS = /^\n+|\n+$/g;

/**
 * A file's text as the model gets it: line endings normalised, and the
 * line breaks around it dropped (editors end files with one). Spaces are
 * kept: the text is the prompt, byte for byte.
 */
export const promptText = (content: string): string =>
  content.replace(LINE_BREAK, "\n").replace(OUTER_LINE_BREAKS, "");

/**
 * The named parts of a file, or `null` for a file with no part markers.
 * Each part runs from its marker to the next one. Throws on a file a
 * prompt author got wrong (text before the first marker, a name used
 * twice): that's a build error, not a run-time state.
 */
export const promptParts = (
  source: string,
  content: string
): Readonly<Record<string, string>> | null => {
  const lines = content.replace(LINE_BREAK, "\n").split("\n");
  if (!lines.some((line) => PART_MARKER.test(line))) {
    return null;
  }
  const parts: Record<string, string[]> = {};
  let current: string[] | undefined;
  for (const line of lines) {
    const name = PART_MARKER.exec(line)?.[1];
    if (name !== undefined) {
      if (parts[name]) {
        throw new Error(`${source}: part "${name}" appears twice`);
      }
      current = [];
      parts[name] = current;
    } else if (current) {
      current.push(line);
    } else if (line.trim() !== "") {
      throw new Error(`${source}: text before the first part marker`);
    }
  }
  return Object.fromEntries(
    Object.entries(parts).map(([name, body]) => [
      name,
      promptText(body.join("\n")),
    ])
  );
};

/**
 * The bundle for a set of files, keyed by path relative to `src/prompts`.
 * Files that are neither `base/NN-name.md` nor `fragments/name.md` (the
 * READMEs) are left out.
 */
export const bundlePrompts = (
  files: Readonly<Record<string, string>>
): PromptBundle => {
  const sources = Object.keys(files).sort();
  const base = sources
    .filter((source) => BASE_FILE.test(source))
    .map((source) => ({ source, text: promptText(files[source] ?? "") }));
  const fragments = Object.fromEntries(
    sources.flatMap((source) => {
      const name = FRAGMENT_FILE.exec(source)?.[1];
      if (name === undefined) {
        return [];
      }
      const content = files[source] ?? "";
      const parts = promptParts(source, content);
      return [
        [
          name,
          parts ? { parts, source } : { source, text: promptText(content) },
        ] as const,
      ];
    })
  );
  return { base, fragments };
};

const HEADER = `// Generated from the Markdown in this folder by \`bun run prompts:generate\`
// (packages/ai). Don't edit it: change the \`.md\` file and regenerate.
// \`generated.test.ts\` fails when the two disagree.`;

/** The source of `generated.ts` for a bundle, before formatting. */
export const generatedModule = (bundle: PromptBundle): string =>
  [
    HEADER,
    "",
    `export const BASE = ${JSON.stringify(bundle.base, null, 2)} as const;`,
    "",
    `export const FRAGMENTS = ${JSON.stringify(bundle.fragments, null, 2)} as const;`,
    "",
  ].join("\n");

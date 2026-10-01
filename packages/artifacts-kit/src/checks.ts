import type { ArtifactCheck } from "./define";

// Checks more than one kind uses. Each is a function that makes a check
// from its settings, so a kind (and later the instance, an org or an agent,
// which may only narrow them) says what the limit is.

/** Text to measure or scan: the content itself, or what a kind derives from it. */
type Text<TContent> = (content: TContent) => string;

const asText = <TContent>(content: TContent): string =>
  typeof content === "string" ? content : JSON.stringify(content);

/**
 * At most `chars` characters, counted as JavaScript does (UTF-16 units),
 * which is how the tool schemas cap content. Structured content is measured
 * as JSON unless the kind says otherwise.
 */
export const sizeLimit = <TContent>({
  chars,
  of = asText,
}: {
  readonly chars: number;
  readonly of?: Text<TContent>;
}): ArtifactCheck<TContent> => ({
  name: "size",
  run: (content) =>
    of(content).length > chars
      ? [`content is longer than ${chars} characters`]
      : [],
});

/**
 * The content matches `pattern`; otherwise one problem, `message`. The
 * cheapest check that something will render at all.
 */
export const matches = <TContent>(
  pattern: RegExp,
  message: string,
  of: Text<TContent> = asText
): ArtifactCheck<TContent> => ({
  name: "matches",
  run: (content) => (pattern.test(of(content)) ? [] : [message]),
});

const IMPORT_SPECIFIERS = [
  // import x from "a"; import { x } from "a"; export { x } from "a"; export * from "a"
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(["'])([^"'\n]+)\1/g,
  // import "a" (a side effect)
  /\bimport\s*(["'])([^"'\n]+)\1/g,
  // import("a"), require("a")
  /\b(?:import|require)\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
] as const;

/**
 * The modules a JavaScript or TypeScript source names, in order of first
 * appearance. A scan, not a parse: it can be fooled by a string that looks
 * like an import, which only ever makes a check stricter.
 */
export const importSpecifiers = (source: string): readonly string[] => {
  const found = IMPORT_SPECIFIERS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => ({
      at: match.index,
      specifier: match[2] ?? "",
    }))
  );
  return [
    ...new Set(
      found.sort((a, b) => a.at - b.at).map(({ specifier }) => specifier)
    ),
  ];
};

/**
 * Imports only from `allowed`: the modules the runtime bundles, since an
 * artifact never reaches the network for code (D24).
 */
export const importsAllowed = <TContent>(
  allowed: readonly string[],
  of: Text<TContent> = asText
): ArtifactCheck<TContent> => {
  const permitted = new Set(allowed);
  return {
    name: "imports",
    run: (content) =>
      importSpecifiers(of(content))
        .filter((specifier) => !permitted.has(specifier))
        .map(
          (specifier) =>
            `imports "${specifier}", which isn't available here. It may import: ${allowed.join(", ") || "nothing"}`
        ),
  };
};

/**
 * A compiler, as the check is given it: `null` when the source compiles,
 * otherwise what's wrong with it. The runtime's own compiler (sucrase in
 * `apps/artifacts`) is passed in, so the kit doesn't ship one.
 */
export type Compile = (source: string) => string | null;

/** Compiles with `compile`, as the runtime will when it renders it. */
export const compiles = <TContent>(
  compile: Compile,
  of: Text<TContent> = asText
): ArtifactCheck<TContent> => ({
  name: "compiles",
  run: (content) => {
    const problem = compile(of(content));
    return problem === null ? [] : [`doesn't compile: ${problem}`];
  },
});

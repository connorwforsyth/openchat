import type { IconName } from "@workspace/icons/names";
import { err, ok, type Result } from "@workspace/shared/result";
import type { z } from "zod";

// An artifact kind, written down in one place (ticket 123, from the
// artifact framework proposal): what a version stores, what the model is
// told, the checks that hold even when it isn't listening, how it's edited,
// shown, compared and exported, and what it may do. It's the tool
// registry's pattern (`packages/ai/src/tools/registry`) applied to kinds.
//
// Everything here is pure data and pure functions, so the server (saving),
// the runtime (rendering) and the client (viewers, menus) can all import it.

/**
 * One rule a version's content must pass. `run` returns the problems, each
 * a sentence the model reads and can act on; none means it passes. Checks
 * are pure and synchronous: anything that needs I/O (a build, a fetch) is a
 * port the check is made with, not something it reaches for.
 */
export interface ArtifactCheck<TContent> {
  /** For tests and traces: which check said so. */
  readonly name: string;
  // biome-ignore lint/style/useConsistentMethodSignatures: a method is checked bivariantly, so a kind's checks fit where any kind is expected (a registry of kinds with different content); each only ever sees its own content.
  run(content: TContent): readonly string[];
}

/**
 * How the model (or a person) changes a version. `apply` takes the latest
 * content (`null` when there's none yet) and returns the next.
 */
export interface ArtifactOperation<TContent, TInput> {
  // biome-ignore lint/style/useConsistentMethodSignatures: a method, as `ArtifactCheck.run` is, so an operation with a narrower input still fits a kind's `operations` record.
  apply(current: TContent | null, input: TInput): TContent;
  readonly description: string;
  readonly input: z.ZodType<TInput>;
  /**
   * Why it can't apply to `current` (a section that isn't there), each a
   * sentence the model can act on; none means `apply` may run. Left out,
   * it always applies.
   */
  // biome-ignore lint/style/useConsistentMethodSignatures: a method, as `apply` is.
  problems?(current: TContent | null, input: TInput): readonly string[];
}

/**
 * Where a kind is shown.
 * - `runtime`: the renderer in the artifact runtime (`apps/artifacts`, D24)
 *   that draws it, or `null` for kinds the runtime doesn't take.
 * - `imports`: for code the runtime runs, the modules it may import.
 * - `panel`: what the chat's panel shows without the runtime: a `frame`
 *   (srcdoc), rendered `markdown`, an `image` (138), or only the `source`.
 */
export interface ArtifactRender {
  readonly imports?: readonly string[];
  /** `document`: the rich-text editor (126); `image`: a picture (138). */
  readonly panel: "document" | "frame" | "image" | "markdown" | "source";
  readonly runtime: string | null;
}

/** What a kind may do, beyond being shown. */
export interface ArtifactCapabilities {
  /** It can call the model from inside the artifact. */
  readonly aiCalls: boolean;
  /** People can pin feedback to rendered elements (D16's `data-src`). */
  readonly annotate: boolean;
  /** It can be shown full screen as slides. */
  readonly present: boolean;
  /** It can be published to a share link of its own. */
  readonly share: boolean;
}

/**
 * How a kind whose stored text isn't what the model writes (a document's
 * JSON, 126) crosses that line. Kinds without one store, and show the
 * model, exactly the text it wrote.
 */
// Methods, as `ArtifactCheck.run` is, so a kind's text fits where any kind
// is expected; each only ever sees its own content.
export interface ArtifactModelText<TContent> {
  /** The model's text (a document's Markdown) as content. */
  // biome-ignore lint/style/useConsistentMethodSignatures: see above.
  fromModel(text: string): TContent;
  /** Content as a version stores it; `content` reads it back. */
  // biome-ignore lint/style/useConsistentMethodSignatures: see above.
  serialize(content: TContent): string;
  /** What the model reads of content: the same language it writes. */
  // biome-ignore lint/style/useConsistentMethodSignatures: see above.
  toModel(content: TContent): string;
}

/** A way out of the app: today, a file with an extension. */
export interface ArtifactExport {
  readonly extension: string;
  readonly format: "file";
}

/**
 * A kind's card under "Make something new" on the Artifacts page (161).
 * The card's label and the prompt it starts a chat with are user-facing,
 * so they live in the client's Lingui catalogs, keyed by kind; the kit
 * only says whether there's a card, where it goes and its badge.
 */
export interface ArtifactStarter {
  /** A `new` or `beta` badge on the card; none when left out. */
  readonly badge?: "beta" | "new";
  /**
   * Where the card sorts, lowest first. Cards without one follow those
   * with one, in the order the kinds are defined.
   */
  readonly order?: number;
}

/**
 * How the Artifacts page's grid draws a kind's thumbnail: `runtime`, a
 * render of the artifact itself (a page, a diagram, a deck's first slide);
 * `none`, only the kind's icon.
 */
export type ArtifactThumbnail = "none" | "runtime";

export interface ArtifactKindDefinition<TContent = unknown> {
  readonly capabilities: ArtifactCapabilities;
  /** Every rule beyond the content's shape, in the order they're reported. */
  readonly checks: readonly ArtifactCheck<TContent>[];
  /** What a version stores. Parsed before any check runs. */
  readonly content: z.ZodType<TContent>;
  /** How versions are compared: a line diff of the text, for now. */
  readonly diff: "text";
  /** How a person edits it: `none` while only the model can, or the rich-text editor (126). */
  readonly editor: "none" | "rich-text";
  readonly export: readonly ArtifactExport[];
  readonly icon: IconName;
  /**
   * The prompt fragment the model is told about this kind, layered after the
   * artifacts fragment (`packages/ai/src/prompts/fragments/artifacts.md`).
   * Empty for a kind whose rules live in the tool descriptions.
   */
  readonly instructions: string;
  /** The value stored in `artifact.kind`; stable API. */
  readonly kind: string;
  /**
   * The kind's name in English. The UI shows it through its own catalog;
   * nothing renders it yet.
   */
  readonly label: string;
  /** For a kind whose stored text isn't what the model writes. */
  readonly modelText?: ArtifactModelText<TContent>;
  /** How the content changes, by operation name. */
  readonly operations: Readonly<
    Record<string, ArtifactOperation<TContent, unknown>>
  >;
  readonly render: ArtifactRender;
  /** Its "Make something new" card; kinds without one get no card. */
  readonly starter?: ArtifactStarter;
  readonly thumbnail: ArtifactThumbnail;
}

/**
 * Declares a kind. It returns the definition unchanged, typed: like
 * `defineTool`, its job is to make the shape checked where it's written.
 */
export const defineArtifactKind = <TContent>(
  definition: ArtifactKindDefinition<TContent>
): ArtifactKindDefinition<TContent> => definition;

/**
 * The kinds that get a "Make something new" card, from `kinds` (an
 * instance's enabled kinds, in the order they're defined): by `order`, then
 * definition order. Pure.
 */
export const starterKindsOf = <
  TKind extends { readonly starter?: ArtifactStarter },
>(
  kinds: readonly TKind[]
): readonly TKind[] => {
  const rank = (kind: TKind) => kind.starter?.order ?? Number.POSITIVE_INFINITY;
  return (
    kinds
      .map((kind, index) => ({ index, kind }))
      .filter((each) => each.kind.starter !== undefined)
      // A fresh array from `filter`, so sorting it in place mutates nothing shared.
      .sort((a, b) => rank(a.kind) - rank(b.kind) || a.index - b.index)
      .map((each) => each.kind)
  );
};

/** Declares an operation, keeping its input type. */
export const defineOperation = <TContent, TInput>(
  operation: ArtifactOperation<TContent, TInput>
): ArtifactOperation<TContent, TInput> => operation;

/**
 * Why `content` isn't a valid version of `definition`; empty when it is.
 * The content's shape is checked first, and the checks only see content
 * that has it. Pure.
 */
export const checkArtifact = <TContent>(
  definition: ArtifactKindDefinition<TContent>,
  content: unknown
): readonly string[] => {
  const parsed = definition.content.safeParse(content);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      [issue.path.length > 0 ? issue.path.join(".") : "content", issue.message]
        .join(" ")
        .trim()
    );
  }
  return definition.checks.flatMap((check) => check.run(parsed.data));
};

/**
 * The text a version stores for what the model wrote: converted for a kind
 * with `modelText` (a document's Markdown becomes its JSON), as written
 * otherwise. Pure.
 */
export const storedFromModel = <TContent>(
  definition: ArtifactKindDefinition<TContent>,
  text: string
): string =>
  definition.modelText
    ? definition.modelText.serialize(definition.modelText.fromModel(text))
    : text;

/**
 * What the model reads of a stored version: converted for a kind with
 * `modelText`, as stored otherwise (and when it doesn't parse). Pure.
 */
export const modelViewOf = <TContent>(
  definition: ArtifactKindDefinition<TContent>,
  stored: string
): string => {
  if (!definition.modelText) {
    return stored;
  }
  const parsed = definition.content.safeParse(stored);
  return parsed.success ? definition.modelText.toModel(parsed.data) : stored;
};

const issuesOf = (error: z.ZodError, at: string): string[] =>
  error.issues.map((issue) =>
    [
      issue.path.length > 0 ? `${at}.${issue.path.join(".")}` : at,
      issue.message,
    ]
      .join(" ")
      .trim()
  );

/**
 * Applies operation `name` to the stored version `stored` (`null` for none
 * yet) and returns the next version's text, or why it can't: an operation
 * the kind doesn't have, input that doesn't fit, content that doesn't parse,
 * or the operation's own problems. The result still has to pass the kind's
 * checks before it's saved. Pure.
 */
export const applyArtifactOperation = <TContent>(
  definition: ArtifactKindDefinition<TContent>,
  stored: string | null,
  name: string,
  input: unknown
): Result<string, readonly string[]> => {
  const operation = Object.hasOwn(definition.operations, name)
    ? definition.operations[name]
    : undefined;
  if (!operation) {
    const known = Object.keys(definition.operations).join(", ");
    return err([
      `a ${definition.kind} has no "${name}" edit. It has: ${known}`,
    ]);
  }
  const parsedInput = operation.input.safeParse(input);
  if (!parsedInput.success) {
    return err(issuesOf(parsedInput.error, "edit"));
  }
  let current: TContent | null = null;
  if (stored !== null) {
    const parsed = definition.content.safeParse(stored);
    if (!parsed.success) {
      return err(issuesOf(parsed.error, "content"));
    }
    current = parsed.data;
  }
  const problems = operation.problems?.(current, parsedInput.data) ?? [];
  if (problems.length > 0) {
    return err(problems);
  }
  const next = operation.apply(current, parsedInput.data);
  const serialize =
    definition.modelText?.serialize ??
    ((content: TContent) =>
      typeof content === "string" ? content : JSON.stringify(content));
  return ok(serialize(next));
};

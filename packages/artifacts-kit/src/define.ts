import type { IconName } from "@workspace/icons/names";
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
}

/**
 * Where a kind is shown.
 * - `runtime`: the renderer in the artifact runtime (`apps/artifacts`, D24)
 *   that draws it, or `null` for kinds the runtime doesn't take.
 * - `imports`: for code the runtime runs, the modules it may import.
 * - `panel`: what the chat's panel shows without the runtime: a `frame`
 *   (srcdoc), rendered `markdown`, or only the `source`.
 */
export interface ArtifactRender {
  readonly imports?: readonly string[];
  readonly panel: "frame" | "markdown" | "source";
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

/** A way out of the app: today, a file with an extension. */
export interface ArtifactExport {
  readonly extension: string;
  readonly format: "file";
}

export interface ArtifactKindDefinition<TContent = unknown> {
  readonly capabilities: ArtifactCapabilities;
  /** Every rule beyond the content's shape, in the order they're reported. */
  readonly checks: readonly ArtifactCheck<TContent>[];
  /** What a version stores. Parsed before any check runs. */
  readonly content: z.ZodType<TContent>;
  /** How versions are compared: a line diff of the text, for now. */
  readonly diff: "text";
  /** How a person edits it; `none` while only the model can. */
  readonly editor: "none";
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
  /** How the content changes, by operation name. */
  readonly operations: Readonly<
    Record<string, ArtifactOperation<TContent, unknown>>
  >;
  readonly render: ArtifactRender;
}

/**
 * Declares a kind. It returns the definition unchanged, typed: like
 * `defineTool`, its job is to make the shape checked where it's written.
 */
export const defineArtifactKind = <TContent>(
  definition: ArtifactKindDefinition<TContent>
): ArtifactKindDefinition<TContent> => definition;

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

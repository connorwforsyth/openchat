import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { TEXT_MAX_CHARS } from "@workspace/artifacts-kit/kinds/text";
import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import {
  type ArtifactId,
  artifactIdSchema,
} from "@workspace/contract/schemas/common";
import {
  type ArtifactKind,
  artifactKindSchema,
  artifactRefPartSchema,
} from "@workspace/contract/schemas/message-parts";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

import { artifactDirectiveSchema } from "../../evals/artifacts/format";

// Artifacts at runtime (078): `create_artifact` and `update_artifact` save a
// document, page or snippet as a numbered version (the store is a port over
// `saveArtifactVersion`), and the result carries the `artifact-ref` the
// answer shows as a card. An AI SDK tool can't write parts into the stream
// itself, so the agent runner lifts the ref out of the result with
// `artifactRefOf`, as the executor does for citations (`toolSources`).
//
// What counts as a valid artifact is its kind's business: each kind is a
// definition in `@workspace/artifacts-kit` (123), and a save runs that
// kind's checks. A failed check is an `invalid` result the model reads and
// can fix, and nothing is saved. The title follows the `:::artifact`
// directive's rule (`evals/artifacts/format.ts`), and the kinds' checks
// agree with the eval's strict reader on every fixture (`artifacts.test.ts`).
//
// This is what `create_artifact` and `update_artifact` share; each tool is
// written down in its own file in `registry/` (080).

/** The text kinds' limit (`@workspace/artifacts-kit`). */
const MAX_CONTENT_CHARS = TEXT_MAX_CHARS;

export const artifactContentSchema = z
  .string()
  .min(1)
  .max(MAX_CONTENT_CHARS)
  .describe("The artifact's complete content, with no surrounding code fence.");

export const artifactLanguageSchema = z
  .string()
  .regex(/^[\w+-]{1,32}$/)
  .optional()
  .describe(
    'For type "code": the language, as a code fence names it (ts, python, sql).'
  );

export const artifactRefSchema = artifactRefPartSchema.omit({ type: true });
/** What the answer's artifact card needs: the `artifact-ref` part without its `type`. */
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const artifactToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    artifact: artifactRefSchema,
    status: z.literal("saved"),
    /** The version's number: 1 for a new artifact. */
    version: z.int().min(1),
  }),
  /** The content isn't a valid artifact of its type; nothing was saved. */
  z.object({ problems: z.array(z.string()), status: z.literal("invalid") }),
  /** `update_artifact` named an artifact this chat doesn't have. */
  z.object({
    artifacts: z.array(
      z.object({
        artifactId: artifactIdSchema,
        kind: artifactKindSchema,
        title: z.string(),
      })
    ),
    status: z.literal("not_found"),
  }),
  z.object({ message: z.string(), status: z.literal("unavailable") }),
]);
export type ArtifactToolOutput = z.infer<typeof artifactToolOutputSchema>;

export interface StoredArtifact {
  readonly artifactId: ArtifactId;
  readonly kind: ArtifactKind;
  readonly title: string;
}

export interface NewArtifactContent {
  /** Omit to create an artifact; pass one to add a version to it. */
  readonly artifactId?: ArtifactId;
  readonly content: string;
  readonly kind: ArtifactKind;
  readonly language: string | null;
  readonly title: string;
}

/** One chat's artifacts, as the tools reach them. The server binds it per run. */
export interface ArtifactStore {
  readonly list: () => Promise<readonly StoredArtifact[]>;
  readonly save: (
    input: NewArtifactContent
  ) => AsyncResult<
    ArtifactRef & { readonly version: number },
    { readonly type: "not_found" }
  >;
}

const FENCE_LINE = /^```/;
const LINE_BREAKS = /\s+/g;

/**
 * The call as the `:::artifact` directive a model would write in a reply,
 * for the eval's strict reader; tests use it to hold the kinds' checks to
 * that reader. A fence line inside the content would end the block early,
 * so those are indented; the reader only judges the result.
 */
export const asDirective = (artifact: {
  readonly content: string;
  readonly language?: string | null;
  readonly title: string;
  readonly type: ArtifactKind;
}): string =>
  [
    `:::artifact{identifier="artifact" type="${artifact.type}" title="${artifact.title.replaceAll('"', "'").replace(LINE_BREAKS, " ")}"}`,
    `\`\`\`${artifact.language ?? ""}`,
    ...artifact.content
      .split("\n")
      .map((line) => (FENCE_LINE.test(line) ? ` ${line}` : line)),
    "```",
    ":::",
  ].join("\n");

/**
 * Why the title isn't one an artifact can have; empty when it is. Titles are
 * read as the directive writes them (quotes swapped, line breaks folded).
 */
const titleProblems = (title: string): readonly string[] => {
  const parsed = artifactDirectiveSchema.shape.title.safeParse(
    title.replaceAll('"', "'").replace(LINE_BREAKS, " ")
  );
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `title ${issue.message}`);
};

/**
 * Why the content isn't a valid artifact of its type; empty when it is.
 * A bad title is reported alone; otherwise the kind's checks run. Pure.
 */
export const artifactProblems = (
  artifact: Parameters<typeof asDirective>[0],
  kinds: ArtifactKindRegistry = builtinArtifactKinds
): readonly string[] => {
  const title = titleProblems(artifact.title);
  return title.length > 0
    ? title
    : kinds.check(artifact.type, artifact.content);
};

/** Saves valid content through the store; every failure is a result the model reads. */
export const saveArtifact = async (
  store: ArtifactStore,
  input: NewArtifactContent,
  kinds: ArtifactKindRegistry = builtinArtifactKinds
): Promise<ArtifactToolOutput> => {
  const problems = artifactProblems({ ...input, type: input.kind }, kinds);
  if (problems.length > 0) {
    return { problems: [...problems], status: "invalid" };
  }
  try {
    const saved = await store.save(input);
    if (!saved.ok) {
      return { artifacts: [...(await store.list())], status: "not_found" };
    }
    const { version, ...artifact } = saved.value;
    return { artifact, status: "saved", version };
  } catch {
    // A failed write is a result the model reads, not a failed run.
    return {
      message: "The artifact couldn't be saved right now.",
      status: "unavailable",
    };
  }
};

/** What the model reads of a result: what happened and what to do next. */
export const artifactModelText = (output: ArtifactToolOutput): string => {
  switch (output.status) {
    case "saved":
      return `Saved "${output.artifact.title}" as version ${output.version} (artifactId: ${output.artifact.artifactId}). The user sees it beside the chat; don't repeat its content in your reply.`;
    case "invalid":
      return `Not saved: ${output.problems.join("; ")}. Fix the content and call the tool again.`;
    case "not_found":
      return output.artifacts.length > 0
        ? `This chat has no artifact with that id. Its artifacts: ${output.artifacts.map((artifact) => `${artifact.artifactId} ("${artifact.title}", ${artifact.kind})`).join(", ")}.`
        : "This chat has no artifacts yet; use create_artifact.";
    case "unavailable":
      return output.message;
    default:
      return output satisfies never;
  }
};

/** The store the artifact tools are bound to for one run. */
export interface ArtifactPorts {
  /**
   * The kinds a save is checked against; the built-in ones when left out.
   * Where the instance, an org or an agent will narrow the rules.
   */
  readonly kinds?: ArtifactKindRegistry;
  readonly store: ArtifactStore;
}

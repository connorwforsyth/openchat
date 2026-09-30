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

import { parseArtifacts } from "../../evals/artifacts/format";

// Artifacts at runtime (078): `create_artifact` and `update_artifact` save a
// document, page or snippet as a numbered version (the store is a port over
// `saveArtifactVersion`), and the result carries the `artifact-ref` the
// answer shows as a card. An AI SDK tool can't write parts into the stream
// itself, so the agent runner lifts the ref out of the result with
// `artifactRefOf`, as the executor does for citations (`toolSources`).
//
// What counts as a valid artifact is the `:::artifact` format's business
// (`evals/artifacts/format.ts`): the call is written out as that directive
// and read back with the eval's strict reader, so the tool and the eval
// agree on every fixture.
//
// This is what `create_artifact` and `update_artifact` share; each tool is
// written down in its own file in `registry/` (080).

/** Larger than any page or document worth reading in a side panel. */
const MAX_CONTENT_CHARS = 400_000;

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
 * for the strict reader. A fence line inside the content would end the
 * block early, so those are indented; the reader only judges the result,
 * and what's saved is the content as given.
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

const LINE_PREFIX = /^line \d+: /;

/** Why the content isn't a valid artifact of its type; empty when it is. Pure. */
export const artifactProblems = (
  artifact: Parameters<typeof asDirective>[0]
): readonly string[] =>
  parseArtifacts(asDirective(artifact)).problems.map((problem) =>
    problem.replace(LINE_PREFIX, "")
  );

/** Saves valid content through the store; every failure is a result the model reads. */
export const saveArtifact = async (
  store: ArtifactStore,
  input: NewArtifactContent
): Promise<ArtifactToolOutput> => {
  const problems = artifactProblems({ ...input, type: input.kind });
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
  readonly store: ArtifactStore;
}

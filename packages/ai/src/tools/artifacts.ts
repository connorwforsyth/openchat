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
import { type Tool, tool } from "ai";
import { z } from "zod";

import {
  artifactDirectiveSchema,
  parseArtifacts,
} from "../../evals/artifacts/format";

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

export const CREATE_ARTIFACT_TOOL = "create_artifact";
export const UPDATE_ARTIFACT_TOOL = "update_artifact";
export const ARTIFACT_TOOLS = [
  CREATE_ARTIFACT_TOOL,
  UPDATE_ARTIFACT_TOOL,
] as const;

/** Larger than any page or document worth reading in a side panel. */
const MAX_CONTENT_CHARS = 400_000;

const contentSchema = z
  .string()
  .min(1)
  .max(MAX_CONTENT_CHARS)
  .describe("The artifact's complete content, with no surrounding code fence.");

const languageSchema = z
  .string()
  .regex(/^[\w+-]{1,32}$/)
  .optional()
  .describe(
    'For type "code": the language, as a code fence names it (ts, python, sql).'
  );

export const createArtifactInputSchema = z.object({
  content: contentSchema,
  language: languageSchema,
  title: artifactDirectiveSchema.shape.title.describe(
    "A short title the user will recognise it by."
  ),
  type: artifactDirectiveSchema.shape.type.describe(
    "html: one complete HTML document. react: one file with a default-exported component. svg: one <svg> element. mermaid: diagram source. markdown: a document. code: a file in any language."
  ),
});
export type CreateArtifactInput = z.infer<typeof createArtifactInputSchema>;

export const updateArtifactInputSchema = z.object({
  artifactId: artifactIdSchema.describe(
    "The artifactId create_artifact returned."
  ),
  content: contentSchema,
  language: languageSchema,
  title: artifactDirectiveSchema.shape.title
    .optional()
    .describe("A new title; leave out to keep the current one."),
});
export type UpdateArtifactInput = z.infer<typeof updateArtifactInputSchema>;

const artifactRefSchema = artifactRefPartSchema.omit({ type: true });
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

const save = async (
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

/** Applies a `create_artifact` call. Exposed for tests; the tool wraps it. */
export const createArtifact = (
  store: ArtifactStore,
  input: CreateArtifactInput
): Promise<ArtifactToolOutput> =>
  save(store, {
    content: input.content,
    kind: input.type,
    language: input.language ?? null,
    title: input.title,
  });

/** Applies an `update_artifact` call: the whole content again, as the next version. */
export const updateArtifact = async (
  store: ArtifactStore,
  input: UpdateArtifactInput
): Promise<ArtifactToolOutput> => {
  let existing: readonly StoredArtifact[];
  try {
    existing = await store.list();
  } catch {
    return {
      message: "The artifact couldn't be read right now.",
      status: "unavailable",
    };
  }
  const current = existing.find(
    (artifact) => artifact.artifactId === input.artifactId
  );
  if (!current) {
    return { artifacts: [...existing], status: "not_found" };
  }
  return save(store, {
    artifactId: current.artifactId,
    content: input.content,
    kind: current.kind,
    language: input.language ?? null,
    title: input.title ?? current.title,
  });
};

const toModelText = (output: ArtifactToolOutput): string => {
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

const toModelOutput = ({ output }: { readonly output: ArtifactToolOutput }) =>
  ({ type: "text", value: toModelText(output) }) as const;

/** The chat's artifact tools over its store, keyed by the names in `ARTIFACT_TOOLS`. */
export const createArtifactTools = (
  store: ArtifactStore
): Readonly<Record<(typeof ARTIFACT_TOOLS)[number], Tool>> => ({
  [CREATE_ARTIFACT_TOOL]: tool({
    description:
      "Create an artifact: a self-contained piece of work the user will want to keep, reuse or see rendered (a document, a web page, a React component, an SVG image, a Mermaid diagram or a code file). It opens beside the chat instead of filling the reply. Use it for substantial content; keep short snippets and explanations in the reply.",
    execute: (input) => createArtifact(store, input),
    inputSchema: createArtifactInputSchema,
    outputSchema: artifactToolOutputSchema,
    toModelOutput,
  }),
  [UPDATE_ARTIFACT_TOOL]: tool({
    description:
      "Replace an artifact's content, saved as its next version; earlier versions are kept. Pass the complete new content, not a diff.",
    execute: (input) => updateArtifact(store, input),
    inputSchema: updateArtifactInputSchema,
    outputSchema: artifactToolOutputSchema,
    toModelOutput,
  }),
});

const savedSchema = z.object({
  artifact: artifactRefSchema,
  status: z.literal("saved"),
});

/** The artifact an artifact tool's output saved; `null` for any other output. */
export const artifactRefOf = (output: unknown): ArtifactRef | null => {
  const parsed = savedSchema.safeParse(output);
  return parsed.success ? parsed.data.artifact : null;
};

/** Whether `name` is one of ours: only their results become artifact cards. */
export const isArtifactTool = (name: string): boolean =>
  (ARTIFACT_TOOLS as readonly string[]).includes(name);

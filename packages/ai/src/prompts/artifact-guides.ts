import type { PromptFile } from "./codegen";

// Artifact guides on demand (160), the way Claude Code's `quickstart` loads a
// type's `SKILL.md` first: a turn that has `load_artifact_guide` is told only
// that each kind has a guide, and loads the one it needs before it writes.
// A turn without the tool (an agent whose version doesn't list it) keeps
// every kind's full text, so nothing it was told goes missing.

/** The tool a model loads a kind's instructions and library guide with. */
export const LOAD_ARTIFACT_GUIDE_TOOL = "load_artifact_guide";

/**
 * Kinds whose instructions stay in every turn: Document is the kind we
 * prefer, so the model shouldn't need a call to know how to write one.
 */
export const ALWAYS_INLINE_KINDS: readonly string[] = ["document"];

const KIND_SOURCE = /^kinds\/(.+)$/;

/** The kind a `kinds/<kind>` prompt file is for; `undefined` for any other. */
export const kindOfSource = (source: string): string | undefined =>
  KIND_SOURCE.exec(source)?.[1];

/** The one line a kind shrinks to when its guide is a call away. */
export const guidePointer = (kind: string): string =>
  `Before you create or update a \`${kind}\` artifact, call \`${LOAD_ARTIFACT_GUIDE_TOOL}\` with type "${kind}" and follow the guide it returns.`;

/**
 * The kinds layer for a turn: whole when the guide tool isn't offered,
 * else one line per kind, except the kinds that always stay whole. Pure.
 */
export const kindPrompts = (
  files: readonly PromptFile[],
  guidesOnDemand: boolean
): readonly PromptFile[] =>
  guidesOnDemand
    ? files.map((file) => {
        const kind = kindOfSource(file.source);
        return kind === undefined ||
          file.text === "" ||
          ALWAYS_INLINE_KINDS.includes(kind)
          ? file
          : { source: file.source, text: guidePointer(kind) };
      })
    : files;

import { z } from "zod";

import { matches, sizeLimit } from "../checks";
import {
  type ArtifactCheck,
  type ArtifactKindDefinition,
  defineArtifactKind,
  defineOperation,
} from "../define";

// What today's kinds share (html, react, svg, mermaid, markdown, code): a
// version is one text, the model replaces it whole, versions compare as a
// line diff, and nobody edits them by hand yet.

/** Larger than any page or document worth reading in a side panel. */
export const TEXT_MAX_CHARS = 400_000;

/**
 * A text version. Any string: whether it's empty or the wrong shape is the
 * kind's check to say, in its own words.
 */
export const textContentSchema = z.string();

/** The one way a text kind changes: the whole content again. */
export const replaceText = defineOperation({
  apply: (_current: string | null, input: { readonly content: string }) =>
    input.content,
  description: "Replace the whole content.",
  input: z.object({ content: textContentSchema }),
});

const NO_CAPABILITIES = {
  aiCalls: false,
  annotate: false,
  present: false,
  share: false,
} as const;

/**
 * A text kind: `shape` is the pattern its content must match to render at
 * all, reported as "content isn't a valid <kind> artifact" when it doesn't.
 * `checks` are the kind's own, run after those two.
 */
export const textKind = ({
  annotate = false,
  checks = [],
  shape,
  ...definition
}: Pick<
  ArtifactKindDefinition<string>,
  "export" | "icon" | "kind" | "label" | "render" | "starter" | "thumbnail"
> & {
  readonly annotate?: boolean;
  readonly checks?: readonly ArtifactCheck<string>[];
  readonly shape: RegExp;
}): ArtifactKindDefinition<string> =>
  defineArtifactKind({
    ...definition,
    capabilities: { ...NO_CAPABILITIES, annotate },
    checks: [
      sizeLimit({ chars: TEXT_MAX_CHARS }),
      matches(shape, `content isn't a valid ${definition.kind} artifact`),
      ...checks,
    ],
    content: textContentSchema,
    diff: "text",
    editor: "none",
    instructions: "",
    operations: { replace: replaceText },
  });

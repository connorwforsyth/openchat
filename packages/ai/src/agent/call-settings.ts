import type { ModelParameters } from "@workspace/contract/schemas/models";
import type { LanguageModelCallOptions } from "ai";

// A preset's or agent's `ModelParameters` as AI SDK call settings. Only
// `reasoningEffort` needs translating; unset values stay unset so the
// provider's defaults apply.

const REASONING: Readonly<
  Record<
    NonNullable<ModelParameters["reasoningEffort"]>,
    LanguageModelCallOptions["reasoning"]
  >
> = { high: "high", low: "low", medium: "medium", off: "none" };

export const callSettings = ({
  reasoningEffort,
  ...rest
}: ModelParameters): LanguageModelCallOptions => ({
  ...rest,
  reasoning: reasoningEffort ? REASONING[reasoningEffort] : undefined,
});

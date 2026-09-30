import type { PromptFile } from "./codegen";

// A turn's instructions, layered (the eve pattern, ticket 079): the base
// files first, then the agent's own instructions (a database row), then the
// fragments this turn calls for, the `@file` mentions and the memory file.
// Each section keeps where it came from, so a trace or an eval can say which
// file put a sentence in front of the model.

export type InstructionLayer =
  | "preceding"
  | "base"
  | "agent"
  | "dynamic"
  | "mentions"
  | "memory";

export interface InstructionSection {
  readonly layer: InstructionLayer;
  /** A file under `src/prompts` (`fragments/memory.md`), or `agent`/`preceding` for text that isn't from one. */
  readonly source: string;
  readonly text: string;
}

export interface ComposeInput {
  /** The agent's instructions, as its version stores them. */
  readonly agent?: string;
  /** The base files (`BASE` from `./generated`), in order. */
  readonly base?: readonly PromptFile[];
  /** Fragments that depend on the turn, such as `FRAGMENTS.workspace` when the chat has a workspace. */
  readonly dynamic?: readonly PromptFile[];
  /** The rendered memory section (`memoryInstructions`). */
  readonly memory?: string;
  /** The rendered `@file` mentions (`workspaceContext`). */
  readonly mentions?: string;
  /**
   * Instructions an earlier composition produced, kept whole ahead of
   * everything else. Memory is added by a wrapper around the turn resolver,
   * which only has the turn's composed string to go on.
   */
  readonly preceding?: string;
}

export interface ComposedInstructions {
  /** The non-empty layers, in the order they appear in `text`. */
  readonly sections: readonly InstructionSection[];
  /** What the model is given; `""` when there are no sections. */
  readonly text: string;
}

const SEPARATOR = "\n\n";

const MENTIONS_SOURCE = "fragments/mentions.md";
const MEMORY_SOURCE = "fragments/memory.md";

const section = (
  layer: InstructionLayer,
  source: string,
  text: string | undefined
): readonly InstructionSection[] =>
  text === undefined || text === "" ? [] : [{ layer, source, text }];

/**
 * The layers in order, joined by a blank line; an empty layer is left out
 * (which is how the placeholder base files add nothing). Pure.
 *
 * One rule is inherited rather than chosen: when there's a memory section,
 * whatever comes before it is trimmed first, so an agent's instructions lose
 * the space around them only in chats that have memory. The snapshot in
 * `server/src/runs/instructions.test.ts` pins it; changing it changes
 * prompts.
 */
export const composeInstructions = (
  input: ComposeInput
): ComposedInstructions => {
  const head = [
    ...section("preceding", "preceding", input.preceding),
    ...(input.base ?? []).flatMap(({ source, text }) =>
      section("base", source, text)
    ),
    ...section("agent", "agent", input.agent),
    ...(input.dynamic ?? []).flatMap(({ source, text }) =>
      section("dynamic", source, text)
    ),
    ...section("mentions", MENTIONS_SOURCE, input.mentions),
  ];
  const memory = section("memory", MEMORY_SOURCE, input.memory);
  const joined = head.map(({ text }) => text).join(SEPARATOR);
  if (memory.length === 0) {
    return { sections: head, text: joined };
  }
  const before = joined.trim();
  return {
    sections: [...head, ...memory],
    text: [...(before === "" ? [] : [before]), input.memory].join(SEPARATOR),
  };
};

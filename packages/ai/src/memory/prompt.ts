import { composeInstructions } from "../prompts/compose";
import { FRAGMENTS } from "../prompts/generated";
import { fillPrompt } from "../prompts/template";

// The memory file in a turn's instructions (D20). It's injected into every
// single-user chat up to `limits.memoryMaxChars`; past the cap it's cut at a
// line boundary and the model is told, so it never reads half an entry and
// can offer to tidy the file up. The words are in
// `prompts/fragments/memory.md`.

export const UPDATE_MEMORY_TOOL = "update_memory";

const { parts } = FRAGMENTS.memory;

export interface CappedMemory {
  /** Characters left out; 0 when the whole file fits. */
  readonly omitted: number;
  readonly text: string;
}

/**
 * The part of the file that fits in `maxChars`: the head, since people put
 * what matters most first. Cuts at the last line break when that keeps at
 * least half the budget, so a long single line still shows something. Pure.
 */
export const capMemory = (content: string, maxChars: number): CappedMemory => {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) {
    return { omitted: 0, text: trimmed };
  }
  const head = trimmed.slice(0, maxChars);
  const lineEnd = head.lastIndexOf("\n");
  const text = (
    lineEnd >= maxChars / 2 ? head.slice(0, lineEnd) : head
  ).trimEnd();
  return { omitted: trimmed.length - text.length, text };
};

export interface MemoryPromptInput {
  readonly content: string;
  readonly maxChars: number;
  readonly mode: "auto" | "propose";
}

/** The memory section for a turn's instructions. Pure. */
export const memoryInstructions = ({
  content,
  maxChars,
  mode,
}: MemoryPromptInput): string => {
  const capped = capMemory(content, maxChars);
  const body = capped.text === "" ? parts.empty : capped.text;
  const cut =
    capped.omitted > 0
      ? `\n${fillPrompt(parts.truncated, { omitted: String(capped.omitted) })}`
      : "";
  const guidance = fillPrompt(parts.guidance, { tool: UPDATE_MEMORY_TOOL });
  return fillPrompt(parts.section, {
    guidance:
      mode === "propose" ? `${guidance} ${parts.proposeNote}` : guidance,
    memory: `${body}${cut}`,
  });
};

/** An agent's (or the chat's) instructions followed by the memory section. Pure. */
export const withMemoryInstructions = (
  instructions: string | undefined,
  memory: MemoryPromptInput
): string =>
  composeInstructions({
    memory: memoryInstructions(memory),
    preceding: instructions,
  }).text;

import { type CappedText, capText } from "@workspace/shared/utils";

// Command output goes into tool results and the panel's log, so every
// provider caps it the same way: keep the head and the tail (where errors
// usually are) and say that something was dropped.

/** Per stream, per command: plenty for a build log, small enough for a prompt. */
export const MAX_OUTPUT_CHARS = 256 * 1024;

export type CappedOutput = CappedText;

export const capOutput = (text: string, max = MAX_OUTPUT_CHARS): CappedOutput =>
  capText(text, max);

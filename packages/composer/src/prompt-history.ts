import type { Message } from "@workspace/contract/schemas/messages";
import { z } from "zod";

// Prompt recall (147), after T3 Code's: ArrowUp in an empty composer walks
// back through the prompts sent on the branch in view, ArrowDown walks
// forward and, past the newest, back to an empty composer. The history is
// worked out from the branch's messages on each keypress, so there's no
// store to keep in step with them. Recall is text only: a mention comes
// back as its `@label` text, and skills and files stay as they are.

export const promptHistoryEntrySchema = z.object({
  /** The message it was sent as. */
  id: z.string().min(1),
  /** As sent, trimmed. */
  prompt: z.string().min(1),
});
export type PromptHistoryEntry = z.infer<typeof promptHistoryEntrySchema>;

/**
 * Where recall is. `recalled` is the text put in the composer; once the
 * composer no longer holds it, the person has edited or sent and recall
 * starts over. The id is looked up again on each step, so a refetch that
 * replaces the messages can't move it.
 */
export const promptHistoryPositionSchema = z.object({
  entryId: z.string().min(1),
  recalled: z.string(),
});
export type PromptHistoryPosition = z.infer<typeof promptHistoryPositionSchema>;

export type PromptHistoryDirection = "backward" | "forward";

export interface PromptHistoryStep {
  /** `null`: recall is over (forward past the newest). */
  readonly position: PromptHistoryPosition | null;
  /** What the composer holds now. */
  readonly prompt: string;
}

/** The fields recall reads from a message on the branch. */
export type PromptHistoryMessage = Pick<Message, "id" | "parts" | "role">;

/**
 * A message's typed words. A user message carrying app data (a plan's
 * approval, 106) was written by the app, not typed, so it has none.
 */
const typedText = (message: PromptHistoryMessage): string => {
  if (message.parts.some((part) => part.type === "data")) {
    return "";
  }
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
};

/**
 * The person's prompts on the branch, oldest first. Files-only messages have
 * no words and are skipped; the same prompt sent twice in a row is one entry
 * (the newer), as a shell's `ignoredups` does. Pure.
 */
export const promptHistory = (
  path: readonly PromptHistoryMessage[]
): readonly PromptHistoryEntry[] => {
  const entries: PromptHistoryEntry[] = [];
  for (const message of path) {
    const prompt = message.role === "user" ? typedText(message) : "";
    if (prompt === "") {
      continue;
    }
    if (entries.at(-1)?.prompt === prompt) {
      entries.pop();
    }
    entries.push({ id: message.id, prompt });
  }
  return entries;
};

const activeIndex = (
  entries: readonly PromptHistoryEntry[],
  position: PromptHistoryPosition | null,
  current: string
): number => {
  if (position === null || position.recalled !== current) {
    return -1;
  }
  const byId = entries.findIndex((entry) => entry.id === position.entryId);
  // A duplicate collapsing can retire the id while its text lives on.
  return byId >= 0
    ? byId
    : entries.map((entry) => entry.prompt).lastIndexOf(position.recalled);
};

/**
 * One press of ArrowUp (`backward`) or ArrowDown (`forward`); `null` when
 * the key should move the caret as usual. Backward starts only from an
 * empty composer and stops at the oldest prompt; forward only moves while
 * recalling. Pure.
 */
export const stepPromptHistory = ({
  current,
  direction,
  entries,
  position,
}: {
  /** The composer's text, trimmed. */
  readonly current: string;
  readonly direction: PromptHistoryDirection;
  readonly entries: readonly PromptHistoryEntry[];
  readonly position: PromptHistoryPosition | null;
}): PromptHistoryStep | null => {
  const at = activeIndex(entries, position, current);
  if (direction === "backward") {
    if (at < 0 && current !== "") {
      return null;
    }
    const entry = entries[at < 0 ? entries.length - 1 : at - 1];
    return entry
      ? {
          position: { entryId: entry.id, recalled: entry.prompt },
          prompt: entry.prompt,
        }
      : null;
  }
  if (at < 0) {
    return null;
  }
  const entry = entries[at + 1];
  return entry
    ? {
        position: { entryId: entry.id, recalled: entry.prompt },
        prompt: entry.prompt,
      }
    : { position: null, prompt: "" };
};

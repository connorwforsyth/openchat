import type { MemoryPatch } from "@workspace/contract/schemas/memory";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// Applying the agent's `update_memory` patches to the memory file (D20).
// Pure, so the server applies them and a client can preview the same edit
// as a diff ("propose" mode) with identical results.
//
// Text matches are exact and must be unique (contract `memoryPatchSchema`):
// a `find` that is missing or ambiguous fails the whole update, so the model
// never edits a line it didn't mean to.

export const memoryPatchErrorSchema = z.discriminatedUnion("type", [
  z.object({
    find: z.string(),
    index: z.int().min(0),
    type: z.literal("not_found"),
  }),
  z.object({
    count: z.int().min(2),
    find: z.string(),
    index: z.int().min(0),
    type: z.literal("ambiguous"),
  }),
]);
export type MemoryPatchError = z.infer<typeof memoryPatchErrorSchema>;

const LEADING_NEWLINE = /^\n/;

const occurrences = (haystack: string, needle: string): number => {
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    count += 1;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
};

/** The file with one appended entry, on a line of its own. */
const appendEntry = (content: string, text: string): string => {
  const entry = text.trim();
  if (content.trim() === "") {
    return `${entry}\n`;
  }
  return `${content.endsWith("\n") ? content : `${content}\n`}${entry}\n`;
};

/**
 * Removes `find`, and the line it leaves empty, so deleting a whole entry
 * doesn't leave a blank line behind.
 */
const deleteSnippet = (content: string, find: string): string => {
  const at = content.indexOf(find);
  const before = content.slice(0, at);
  const after = content.slice(at + find.length);
  const lineStart = before.lastIndexOf("\n") + 1;
  const wholeLine =
    before.slice(lineStart).trim() === "" &&
    (after.startsWith("\n") || after === "");
  if (wholeLine) {
    return before.slice(0, lineStart) + after.replace(LEADING_NEWLINE, "");
  }
  return before + after;
};

export const applyMemoryPatch = (
  content: string,
  patch: MemoryPatch,
  index = 0
): Result<string, MemoryPatchError> => {
  if (patch.op === "append") {
    return ok(appendEntry(content, patch.text));
  }
  const count = occurrences(content, patch.find);
  if (count === 0) {
    return err({ find: patch.find, index, type: "not_found" });
  }
  if (count > 1) {
    return err({ count, find: patch.find, index, type: "ambiguous" });
  }
  switch (patch.op) {
    case "replace":
      return ok(content.replace(patch.find, () => patch.replace));
    case "delete":
      return ok(deleteSnippet(content, patch.find));
    default:
      return patch satisfies never;
  }
};

/** Applies patches in order, each to the previous one's result. All or nothing. */
export const applyMemoryPatches = (
  content: string,
  patches: readonly MemoryPatch[]
): Result<string, MemoryPatchError> => {
  let next = content;
  for (const [index, patch] of patches.entries()) {
    const applied = applyMemoryPatch(next, patch, index);
    if (!applied.ok) {
      return applied;
    }
    next = applied.value;
  }
  return ok(next);
};

/** What the model reads when an edit fails, so it can fix the patch and retry. */
export const describePatchError = (error: MemoryPatchError): string => {
  switch (error.type) {
    case "not_found":
      return `Patch ${error.index + 1}: the text to find isn't in the memory file. Copy it exactly from the file.`;
    case "ambiguous":
      return `Patch ${error.index + 1}: the text to find occurs ${error.count} times. Include more of the line so it matches once.`;
    default:
      return error satisfies never;
  }
};

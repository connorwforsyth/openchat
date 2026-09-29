import type { WorkspaceFileRef } from "@workspace/ai/messages/workspace-file";

import type { WorkspaceRead } from "./sandbox";

// `@file` mentions as the model gets them (D7). The composer sends each as a
// `data-workspace-file` part, which the AI SDK drops on the way to the model,
// so the turn resolves them here into text for its instructions: a small
// text file goes in whole, as it is in the workspace now, and anything else
// becomes a short note pointing the model at `read`. Like attachments, a
// mention never fails the turn.

/** Largest file inlined whole; bigger ones are left to `read`. */
export const INLINE_MAX_BYTES = 32 * 1024;

/** Across one message, so a message naming many files can't flood the prompt. */
export const INLINE_BUDGET_BYTES = 4 * INLINE_MAX_BYTES;

const decoder = new TextDecoder("utf-8", { fatal: true });

const attribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

const note = (path: string, text: string): string =>
  `<workspace-file path="${attribute(path)}" omitted="true">${text}</workspace-file>`;

const inline = (path: string, content: string): string =>
  `<workspace-file path="${attribute(path)}">\n${content}\n</workspace-file>`;

const decode = (bytes: Uint8Array): string | null => {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};

/**
 * One block per mentioned file, in mention order: its text, or a note on
 * why it isn't there. `read` is `undefined` when the turn has no workspace.
 */
export const resolveWorkspaceFiles = async (
  refs: readonly WorkspaceFileRef[],
  read: WorkspaceRead | undefined
): Promise<readonly string[]> => {
  const blocks: string[] = [];
  let budget = INLINE_BUDGET_BYTES;
  for (const { path } of refs) {
    if (!read) {
      blocks.push(note(path, "The workspace is off for this message."));
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a message names a handful of files, and the budget goes in mention order.
    const file = await read(path);
    if (!file.ok) {
      blocks.push(
        note(
          path,
          file.error.type === "not_found"
            ? "No such file in the workspace."
            : `The workspace couldn't be read: ${file.error.message}`
        )
      );
      continue;
    }
    const size = file.value.byteLength;
    const text =
      size <= Math.min(INLINE_MAX_BYTES, budget) ? decode(file.value) : null;
    if (text === null) {
      blocks.push(
        note(
          path,
          size > INLINE_MAX_BYTES || size > budget
            ? `The file is ${size} bytes, too large to include here. Use the read tool to read it, a range of lines at a time.`
            : "The file isn't UTF-8 text, so it isn't shown. Inspect it with bash if you need to."
        )
      );
      continue;
    }
    budget -= size;
    blocks.push(inline(path, text));
  }
  return blocks;
};

/** The mentions of the message a turn answers, as instructions; `undefined` for none. */
export const workspaceContext = async (
  refs: readonly WorkspaceFileRef[],
  read: WorkspaceRead | undefined
): Promise<string | undefined> => {
  if (refs.length === 0) {
    return;
  }
  const blocks = await resolveWorkspaceFiles(refs, read);
  return [
    "The user's latest message mentions these files from the workspace. They are shown as they are now:",
    ...blocks,
  ].join("\n\n");
};

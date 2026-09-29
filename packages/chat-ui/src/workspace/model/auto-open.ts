import type { Message } from "@workspace/contract/schemas/messages";

import {
  indexToolResults,
  type ToolCallPart,
  type ToolResultPart,
} from "../../model/parts";
import { toolSummary } from "../../model/tool-summary";
import { workspacePath } from "../../model/workspace";
import { isHtmlPath } from "./browser";

// When the Workspace panel opens by itself (066): the agent wrote or edited
// an `.html` file, or a `preview` call succeeded. Only as it happens: a chat
// loaded with such calls in its history stays as the person left it. Pure,
// so the rules are tested without rendering.

/** Something the agent did that the Preview should show. */
export interface PreviewOpening {
  /** The message with the call, and the one with its result (may differ after an approval). */
  readonly messageIds: readonly string[];
  /** A workspace path (`index.html`) for a file; `null` for a preview. */
  readonly path: string | null;
  readonly toolCallId: string;
  /** The preview's URL, for a `preview` call. */
  readonly url: string | null;
}

/** Which message each tool result is in, by the call it answers. */
const resultMessages = (
  messages: readonly Pick<Message, "id" | "parts">[]
): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-result") {
        found.set(part.toolCallId, message.id);
      }
    }
  }
  return found;
};

/** What a settled call opens, if anything. */
const openingOf = (
  call: ToolCallPart,
  result: ToolResultPart,
  messageIds: readonly string[]
): PreviewOpening | null => {
  const summary = toolSummary(call, result);
  if (
    summary.detail.kind === "file-change" &&
    isHtmlPath(summary.detail.change.path)
  ) {
    return {
      messageIds,
      path: workspacePath(summary.detail.change.path),
      toolCallId: call.toolCallId,
      url: null,
    };
  }
  if (call.toolName === "preview" && summary.previewUrl) {
    return {
      messageIds,
      path: null,
      toolCallId: call.toolCallId,
      url: summary.previewUrl,
    };
  }
  return null;
};

/** Every opening on the branch, oldest first. */
export const previewOpenings = (
  messages: readonly Pick<Message, "id" | "parts">[]
): PreviewOpening[] => {
  const results = indexToolResults(messages);
  const resultIn = resultMessages(messages);
  const openings: PreviewOpening[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      const result =
        part.type === "tool-call" ? results.get(part.toolCallId) : undefined;
      const opening =
        part.type === "tool-call" && result
          ? openingOf(part, result, [
              message.id,
              resultIn.get(part.toolCallId) ?? message.id,
            ])
          : null;
      if (opening) {
        openings.push(opening);
      }
    }
  }
  return openings;
};

/** What the screen has already seen of the chat. */
export interface OpeningWatch {
  /** Messages on screen at the last look. */
  readonly messageIds: ReadonlySet<string>;
  /** Openings already acted on, or already there. */
  readonly seen: ReadonlySet<string>;
}

/**
 * The opening to act on now, if any, and what's been seen after it. The
 * first look only takes stock. After that an opening counts when it's new
 * and belongs to a message that was already on screen or is streaming: a
 * branch switched to or loaded with history brings its openings in with
 * messages that weren't there before.
 */
export const watchOpenings = (
  watch: OpeningWatch | null,
  messages: readonly Pick<Message, "id" | "parts">[],
  streamingId: string | null
): { readonly open: PreviewOpening | null; readonly watch: OpeningWatch } => {
  const openings = previewOpenings(messages);
  const next: OpeningWatch = {
    messageIds: new Set(messages.map((message) => message.id)),
    seen: new Set([
      ...(watch?.seen ?? []),
      ...openings.map((each) => each.toolCallId),
    ]),
  };
  if (!watch) {
    return { open: null, watch: next };
  }
  const fresh = openings.filter(
    (each) =>
      !watch.seen.has(each.toolCallId) &&
      each.messageIds.some(
        (id) => watch.messageIds.has(id) || id === streamingId
      )
  );
  return { open: fresh.at(-1) ?? null, watch: next };
};

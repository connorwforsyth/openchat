import type { Editor } from "@tiptap/core";
import { useCallback, useRef } from "react";

import { serializeDoc, textToDoc } from "../doc";
import {
  type PromptHistoryDirection,
  type PromptHistoryEntry,
  type PromptHistoryPosition,
  stepPromptHistory,
} from "../prompt-history";

// ArrowUp in an empty composer brings back the last prompt (147); see
// prompt-history.ts. The editor's keymap calls `recall`.

export interface PromptRecall {
  /** One arrow press; true if it put a prompt in (or emptied the composer). */
  readonly recall: (direction: PromptHistoryDirection) => boolean;
  /** Recall is over: the message went, or another chat's draft came in. */
  readonly reset: () => void;
}

export const usePromptRecall = (
  editor: Editor,
  history: readonly PromptHistoryEntry[]
): PromptRecall => {
  const position = useRef<PromptHistoryPosition | null>(null);

  const recall = useCallback(
    (direction: PromptHistoryDirection) => {
      const current = serializeDoc(editor.getJSON()).text;
      const { empty, from } = editor.state.selection;
      // Starting needs the caret at the start of an empty composer (blank
      // lines are still empty); after that, the arrows keep stepping until
      // the recalled text is edited.
      const atStart = empty && from <= 1;
      const browsing = position.current?.recalled === current;
      if (!(browsing || atStart)) {
        return false;
      }
      const step = stepPromptHistory({
        current,
        direction,
        entries: history,
        position: position.current,
      });
      if (step === null) {
        return false;
      }
      position.current = step.position;
      // Text only, with the caret at its end.
      editor.commands.setContent(textToDoc(step.prompt), { emitUpdate: true });
      editor.commands.focus("end");
      return true;
    },
    [editor, history]
  );

  const reset = useCallback(() => {
    position.current = null;
  }, []);

  return { recall, reset };
};

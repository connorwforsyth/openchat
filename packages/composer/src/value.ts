import type { JSONContent } from "@tiptap/core";
import type { LibraryItemId } from "@workspace/contract/schemas/common";

import { serializeDoc } from "./doc";
import type {
  ComposerAttachment,
  ComposerValue,
  PickedSkillOption,
} from "./schemas";

export interface ComposerDraft {
  readonly attachments: readonly ComposerAttachment[];
  /** The editor's document (`editor.getJSON()`). */
  readonly doc: JSONContent;
  /** Skills picked for the message (127); left out, none. */
  readonly skills?: readonly PickedSkillOption[];
  readonly templateId: LibraryItemId | null;
}

/** The value to submit, derived from the document. */
export const buildComposerValue = (draft: ComposerDraft): ComposerValue => {
  const { mentions, text } = serializeDoc(draft.doc);
  return {
    attachments: [...draft.attachments],
    mentions: [...mentions],
    skills: (draft.skills ?? []).map(({ id, name }) => ({ id, name })),
    // A template the user has since erased entirely no longer describes the text.
    templateId: text === "" ? null : draft.templateId,
    text,
  };
};

/** Something to send: words or a file. */
export const hasContent = (draft: {
  readonly attachments: readonly unknown[];
  readonly text: string;
}): boolean => draft.text.trim() !== "" || draft.attachments.length > 0;

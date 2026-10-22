import type { JSONContent } from "@tiptap/core";
import type { LibraryItemId } from "@workspace/contract/schemas/common";

import { serializeDoc } from "./doc";
import type {
  ComposerAttachment,
  ComposerValue,
  MentionToken,
  PickedSkillOption,
} from "./schemas";

export interface ComposerDraft {
  readonly attachments: readonly ComposerAttachment[];
  /** The editor's document (`editor.getJSON()`). */
  readonly doc: JSONContent;
  readonly templateId: LibraryItemId | null;
}

/** The skill chips (127), once each, in text order. Pure. */
export const skillsOf = (
  mentions: readonly MentionToken[]
): PickedSkillOption[] => {
  const skills: PickedSkillOption[] = [];
  for (const mention of mentions) {
    if (
      mention.kind === "skill" &&
      !skills.some((skill) => skill.id === mention.id)
    ) {
      skills.push({
        id: mention.id,
        name: mention.label,
        ...(mention.versionId ? { versionId: mention.versionId } : {}),
      });
    }
  }
  return skills;
};

/** The value to submit, derived from the document. */
export const buildComposerValue = (draft: ComposerDraft): ComposerValue => {
  const { mentions, text } = serializeDoc(draft.doc);
  return {
    attachments: [...draft.attachments],
    mentions: [...mentions],
    skills: skillsOf(mentions),
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

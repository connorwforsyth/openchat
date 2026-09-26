import type { JSONContent } from "@tiptap/core";

import { type MentionToken, mentionTokenSchema } from "./schemas";

// The editor's document is ProseMirror JSON: paragraphs of text, hard breaks,
// inline `code` marks and mention nodes (see editor/extensions.ts). These
// functions turn it into the plain text and mention offsets the composer
// submits, and plain text back into content. Pure and schema-light, so they
// run and test without an editor (only a type comes from TipTap).

/** Node and mark names in the editor schema. */
export const MENTION_NODE = "mention";
const PARAGRAPH_NODE = "paragraph";
const HARD_BREAK_NODE = "hardBreak";
const TEXT_NODE = "text";
const CODE_MARK = "code";

export interface SerializedDoc {
  /** In text order; `text.slice(start, end)` is `@label`. */
  readonly mentions: readonly MentionToken[];
  /** Trimmed. Paragraphs and hard breaks become `\n`; inline code keeps its backticks. */
  readonly text: string;
}

const LEADING_WHITESPACE = /^\s*/;

const stringAttr = (node: JSONContent, key: string): string | undefined => {
  const value = node.attrs?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/**
 * A mention node as a token. Node attributes are untyped JSON, so they're
 * parsed back into the contract's branded ids; a node that doesn't parse
 * (pasted from elsewhere, say) stays plain text.
 */
const mentionToken = (
  node: JSONContent,
  start: number
): MentionToken | undefined => {
  const label = stringAttr(node, "label") ?? "";
  const parsed = mentionTokenSchema.safeParse({
    end: start + label.length + 1,
    id: stringAttr(node, "id"),
    kind: stringAttr(node, "kind") ?? "user",
    label,
    start,
  });
  return parsed.success ? parsed.data : undefined;
};

const inlineText = (node: JSONContent): string => {
  const text = node.text ?? "";
  return node.marks?.some((mark) => mark.type === CODE_MARK)
    ? `\`${text}\``
    : text;
};

/** Plain text and mention tokens from the editor's JSON document. */
export const serializeDoc = (doc: JSONContent): SerializedDoc => {
  let text = "";
  const mentions: MentionToken[] = [];
  const blocks = doc.content ?? [];
  blocks.forEach((block, index) => {
    if (index > 0) {
      text += "\n";
    }
    for (const node of block.content ?? []) {
      if (node.type === HARD_BREAK_NODE) {
        text += "\n";
      } else if (node.type === MENTION_NODE) {
        const token = mentionToken(node, text.length);
        text += `@${stringAttr(node, "label") ?? ""}`;
        if (token) {
          mentions.push(token);
        }
      } else if (node.type === TEXT_NODE) {
        text += inlineText(node);
      }
    }
  });

  const leading = LEADING_WHITESPACE.exec(text)?.[0].length ?? 0;
  const trimmed = text.trim();
  return {
    mentions: mentions.map((token) => ({
      ...token,
      end: token.end - leading,
      start: token.start - leading,
    })),
    text: trimmed,
  };
};

/**
 * Inline content for plain text: newlines become hard breaks, so inserting a
 * multi-line template stays inside the paragraph the caret is in.
 */
export const textToInline = (text: string): JSONContent[] =>
  text.split("\n").flatMap((line, index): JSONContent[] => {
    const parts: JSONContent[] = index > 0 ? [{ type: HARD_BREAK_NODE }] : [];
    return line === "" ? parts : [...parts, { text: line, type: TEXT_NODE }];
  });

/** A whole document holding plain text, for starting the editor with a draft. */
export const textToDoc = (text: string): JSONContent => ({
  content: [{ content: textToInline(text), type: PARAGRAPH_NODE }],
  type: "doc",
});

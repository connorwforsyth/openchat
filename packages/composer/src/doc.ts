import type { JSONContent } from "@tiptap/core";

import { type MentionToken, mentionTokenSchema } from "./schemas";

// The editor's document is ProseMirror JSON: paragraphs of text, hard breaks,
// inline `code` marks and mention nodes (see editor/extensions.ts). These
// functions turn it into the plain text and mention offsets the composer
// submits, and plain text back into content. Pure and schema-light, so they
// run and test without an editor (only a type comes from TipTap).

/** Node and mark names in the editor schema. */
export const MENTION_NODE = "mention";
/** A prompt's `{{variable}}` waiting to be filled in (see `variables.ts`). */
export const VARIABLE_NODE = "promptVariable";
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

/** Where a chip kind keeps Mention's own `id` attribute in its token. */
const idField = {
  agent: "id",
  artifact: "artifact",
  file: "path",
  skill: "id",
  user: "id",
} as const satisfies Record<MentionToken["kind"], string>;

/**
 * A chip node as a token. Node attributes are untyped JSON, so they're
 * parsed back into the contract's branded ids; a node that doesn't parse
 * (pasted from elsewhere, say) stays plain text.
 */
const mentionToken = (
  node: JSONContent,
  start: number
): MentionToken | undefined => {
  const label = stringAttr(node, "label") ?? "";
  const kind = stringAttr(node, "kind") ?? "user";
  const versionId = stringAttr(node, "versionId");
  const field = idField[kind as MentionToken["kind"]] ?? "id";
  const parsed = mentionTokenSchema.safeParse({
    end: start + label.length + 1,
    kind,
    label,
    start,
    [field]: stringAttr(node, "id"),
    ...(versionId ? { versionId } : {}),
  });
  return parsed.success ? parsed.data : undefined;
};

// An unfilled variable with no default is dropped with the space before it
// when what follows is a space, punctuation or the end of the line, so
// "Write about {{topic}}." reads "Write about." and not "Write about ."
const CLOSES = /^[\s,.;:!?)\]]|^$/;

const inlineText = (node: JSONContent): string => {
  const text = node.text ?? "";
  return node.marks?.some((mark) => mark.type === CODE_MARK)
    ? `\`${text}\``
    : text;
};

/** A variable left unfilled: its default, else nothing, and maybe its space. */
const withVariable = (
  text: string,
  node: JSONContent,
  next: JSONContent | undefined
): string => {
  const fill = stringAttr(node, "fallback");
  if (fill !== undefined) {
    return text + fill;
  }
  const after = next?.type === TEXT_NODE ? (next.text ?? "") : "";
  return text.endsWith(" ") && CLOSES.test(after) ? text.slice(0, -1) : text;
};

/** `text` with one inline node's text after it. */
const withInline = (
  text: string,
  node: JSONContent,
  next: JSONContent | undefined
): string => {
  switch (node.type) {
    case VARIABLE_NODE:
      return withVariable(text, node, next);
    case HARD_BREAK_NODE:
      return `${text}\n`;
    case MENTION_NODE:
      return `${text}@${stringAttr(node, "label") ?? ""}`;
    case TEXT_NODE:
      return text + inlineText(node);
    default:
      return text;
  }
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
    const nodes = block.content ?? [];
    nodes.forEach((node, at) => {
      if (node.type === MENTION_NODE) {
        const token = mentionToken(node, text.length);
        if (token) {
          mentions.push(token);
        }
      }
      text = withInline(text, node, nodes[at + 1]);
    });
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

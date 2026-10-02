import { z } from "zod";

import { defineOperation } from "../../define";
import { markdownToDocument } from "./markdown";
import type { Document, DocumentBlock, DocumentInline } from "./schema";

// How the model edits a document without sending all of it (126). A
// section is a top-level heading and every block after it up to the next
// heading of the same or a higher level (a smaller number), so "Steps"
// under "## Steps" holds its "### Notes" too. Edits name a section by its
// heading's text and carry Markdown, which becomes blocks. Whole-document
// replace is the fallback. Each is pure; `problems` says why one can't
// apply (no such heading) before `apply` runs.

/** The text of a heading, as the model names it: plain, single-spaced. */
export const inlineText = (
  nodes: readonly DocumentInline[] | undefined
): string =>
  (nodes ?? [])
    .map((node) => (node.type === "text" ? node.text : " "))
    .join("");

const LEADING_HASHES = /^#+\s*/;
const SPACES = /\s+/g;

const normalise = (heading: string): string =>
  heading.replace(LEADING_HASHES, "").replace(SPACES, " ").trim().toLowerCase();

/** Every top-level heading's text, in order: what the model can name. */
export const documentHeadings = (document: Document): readonly string[] =>
  document.content.flatMap((block) =>
    block.type === "heading" ? [inlineText(block.content).trim()] : []
  );

export interface DocumentSection {
  /** One past the section's last block. */
  readonly end: number;
  readonly level: number;
  /** The heading's index in the document's blocks. */
  readonly start: number;
}

/**
 * The first top-level section whose heading reads `heading` (ignoring
 * case, extra spaces and leading `#`s); `null` when there's none. Pure.
 */
export const findSection = (
  document: Document,
  heading: string
): DocumentSection | null => {
  const wanted = normalise(heading);
  const blocks = document.content;
  const start = blocks.findIndex(
    (block) =>
      block.type === "heading" &&
      normalise(inlineText(block.content)) === wanted
  );
  const found = blocks[start];
  if (start < 0 || found?.type !== "heading") {
    return null;
  }
  const { level } = found.attrs;
  const next = blocks.findIndex(
    (block, index) =>
      index > start && block.type === "heading" && block.attrs.level <= level
  );
  return { end: next < 0 ? blocks.length : next, level, start };
};

const noSection = (document: Document, heading: string): string => {
  const headings = documentHeadings(document);
  return headings.length > 0
    ? `there's no section headed "${heading}". Its headings: ${headings.map((each) => `"${each}"`).join(", ")}`
    : `there's no section headed "${heading}": the document has no headings. Replace the whole content instead`;
};

const blocksOf = (markdown: string): readonly DocumentBlock[] =>
  markdownToDocument(markdown).content.filter(
    (block) => !(block.type === "paragraph" && !block.content)
  );

const withBlocks = (
  document: Document,
  from: number,
  to: number,
  blocks: readonly DocumentBlock[]
): Document => {
  const content = [
    ...document.content.slice(0, from),
    ...blocks,
    ...document.content.slice(to),
  ];
  return {
    ...document,
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
};

const EMPTY: Document = { content: [{ type: "paragraph" }], type: "doc" };

const headingInput = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .describe("The section's heading text, as it reads (without the #s).");

const markdownInput = z
  .string()
  .max(400_000)
  .describe(
    "Markdown: headings, paragraphs, lists, task lists, tables, quotes, code, links and images."
  );

/** The whole document again, from Markdown. */
export const replaceDocument = defineOperation({
  apply: (_current: Document | null, input: { readonly content: string }) =>
    markdownToDocument(input.content),
  description: "Replace the whole document with this Markdown.",
  input: z.object({ content: markdownInput.min(1) }),
});

/**
 * A section's body, or the whole section: when the Markdown starts with a
 * heading, it replaces the heading too (to rename it); otherwise the
 * heading stays and the body is replaced.
 */
export const replaceSection = defineOperation({
  apply: (
    current: Document | null,
    input: { readonly content: string; readonly heading: string }
  ) => {
    const document = current ?? EMPTY;
    const section = findSection(document, input.heading);
    if (!section) {
      return document;
    }
    const blocks = blocksOf(input.content);
    const keepsHeading = blocks[0]?.type !== "heading";
    return withBlocks(
      document,
      keepsHeading ? section.start + 1 : section.start,
      section.end,
      blocks
    );
  },
  description:
    "Replace the section under a heading (up to the next heading of the same or a higher level). Start the Markdown with a heading to replace the heading too; otherwise the heading stays.",
  input: z.object({ content: markdownInput, heading: headingInput }),
  problems: (current, input) =>
    current && findSection(current, input.heading)
      ? []
      : [noSection(current ?? EMPTY, input.heading)],
});

/** Blocks at the start or end of a section, or at the document's end. */
export const insertBlocks = defineOperation({
  apply: (
    current: Document | null,
    input: {
      readonly content: string;
      readonly heading?: string;
      readonly position?: "section_end" | "section_start";
    }
  ) => {
    const document = current ?? EMPTY;
    const blocks = blocksOf(input.content);
    if (input.heading === undefined) {
      const only = document.content;
      const isBlank =
        only.length === 1 && only[0]?.type === "paragraph" && !only[0].content;
      return isBlank
        ? withBlocks(document, 0, 1, blocks)
        : withBlocks(document, only.length, only.length, blocks);
    }
    const section = findSection(document, input.heading);
    if (!section) {
      return document;
    }
    const at =
      input.position === "section_start" ? section.start + 1 : section.end;
    return withBlocks(document, at, at, blocks);
  },
  description:
    "Insert Markdown blocks right after a heading (section_start) or at the end of its section (section_end, the default). Without a heading, at the end of the document.",
  input: z.object({
    content: markdownInput.min(1),
    heading: headingInput.optional(),
    position: z.enum(["section_end", "section_start"]).optional(),
  }),
  problems: (current, input) =>
    input.heading === undefined ||
    (current && findSection(current, input.heading))
      ? []
      : [noSection(current ?? EMPTY, input.heading)],
});

/** A section, heading and all. */
export const deleteSection = defineOperation({
  apply: (current: Document | null, input: { readonly heading: string }) => {
    const document = current ?? EMPTY;
    const section = findSection(document, input.heading);
    return section
      ? withBlocks(document, section.start, section.end, [])
      : document;
  },
  description: "Delete a section: its heading and everything under it.",
  input: z.object({ heading: headingInput }),
  problems: (current, input) =>
    current && findSection(current, input.heading)
      ? []
      : [noSection(current ?? EMPTY, input.heading)],
});

/** The structured edits the model may make, by the name it calls them. */
export const DOCUMENT_EDITS = {
  delete_section: deleteSection,
  insert: insertBlocks,
  replace_section: replaceSection,
} as const;

export type DocumentEditName = keyof typeof DOCUMENT_EDITS;

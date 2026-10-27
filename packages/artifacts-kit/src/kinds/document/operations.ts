import { z } from "zod";

import { defineOperation } from "../../define";
import { markdownToDocument } from "./markdown";
import type { Document, DocumentBlock, DocumentInline } from "./schema";

// How the model edits a document without sending all of it (126). A
// section is a heading and every block after it up to the next heading of
// the same or a higher level (a smaller number), so "## Steps" holds its
// "### Notes" too. Its body is the part before its first subsection.
// replace_section and insert work on the body and never touch a subsection
// the model didn't name: renaming "# Plan" once deleted the "## Packing"
// under it, and the model went on to say Packing was still there.
// delete_section takes the whole section. Edits name a section by its
// heading's text and carry Markdown, which becomes blocks. Whole-document
// replace is the fallback. Each is pure; `problems` says why one can't
// apply (no such heading) before `apply` runs, and `report` says what it
// changed, naming every heading it kept or removed.

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
  headingsOf(document.content);

export interface DocumentSection {
  /** One past its body's last block: the next heading of any level. */
  readonly bodyEnd: number;
  /** One past the section's last block, its subsections included. */
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
  const nextHeading = (isEnd: (level: number) => boolean): number => {
    const next = blocks.findIndex(
      (block, index) =>
        index > start && block.type === "heading" && isEnd(block.attrs.level)
    );
    return next < 0 ? blocks.length : next;
  };
  return {
    bodyEnd: nextHeading(() => true),
    end: nextHeading((each) => each <= level),
    level,
    start,
  };
};

const headingsOf = (blocks: readonly DocumentBlock[]): readonly string[] =>
  blocks.flatMap((block) =>
    block.type === "heading" ? [inlineText(block.content).trim()] : []
  );

const quoted = (headings: readonly string[]): string =>
  headings.map((each) => `"${each}"`).join(", ");

/** Says so when `heading` names more than one heading: edits take the first. */
const sameNamed = (document: Document, heading: string): string[] => {
  const count = documentHeadings(document).filter(
    (each) => normalise(each) === normalise(heading)
  ).length;
  return count > 1
    ? [`${count} headings are named "${heading}"; changed the first.`]
    : [];
};

/** The headings of a section's subsections, in order. */
const subsectionsOf = (
  document: Document,
  section: DocumentSection
): readonly string[] =>
  headingsOf(document.content.slice(section.bodyEnd, section.end));

const noSection = (document: Document, heading: string): string => {
  const headings = documentHeadings(document);
  return headings.length > 0
    ? `there's no section headed "${heading}". Its headings: ${quoted(headings)}`
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
  report: (current: Document | null, input: { readonly content: string }) => {
    const remaining = documentHeadings(markdownToDocument(input.content)).map(
      normalise
    );
    const removed = documentHeadings(current ?? EMPTY).filter((heading) => {
      const at = remaining.indexOf(normalise(heading));
      if (at < 0) {
        return true;
      }
      remaining.splice(at, 1);
      return false;
    });
    return removed.length > 0
      ? [
          `Replaced the whole document. Headings no longer in it: ${quoted(removed)}.`,
        ]
      : ["Replaced the whole document; every heading it had is still there."];
  },
});

/**
 * A section's body (the blocks before its first subsection), and its
 * heading too when the Markdown starts with one (to rename it). Its
 * subsections stay, so the Markdown mustn't repeat one.
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
      section.bodyEnd,
      blocks
    );
  },
  description:
    "Replace a section's heading and the text under it, up to its first subsection. Its subsections stay: replace each on its own, or delete_section one to drop it. Start the Markdown with a heading to replace the heading too; otherwise the heading stays.",
  input: z.object({ content: markdownInput, heading: headingInput }),
  problems: (current, input) => {
    const section = current ? findSection(current, input.heading) : null;
    if (!(current && section)) {
      return [noSection(current ?? EMPTY, input.heading)];
    }
    const blocks = blocksOf(input.content);
    // A leading heading is the rename, not a repeat or a new section.
    const body = blocks[0]?.type === "heading" ? blocks.slice(1) : blocks;
    const outranking = body.flatMap((block) =>
      block.type === "heading" && block.attrs.level <= section.level
        ? [inlineText(block.content).trim()]
        : []
    );
    if (outranking.length > 0) {
      return [
        `replace_section replaces only the text under "${input.heading}", but the Markdown starts new sections at its level or above (${quoted(outranking)}), which would move its subsections under them. Leave them out, and add them with insert after the section instead`,
      ];
    }
    const kept = subsectionsOf(current, section);
    const repeated = headingsOf(body).filter((heading) =>
      kept.some((each) => normalise(each) === normalise(heading))
    );
    return repeated.length > 0
      ? [
          `replace_section keeps the subsections under "${input.heading}" (${quoted(kept)}) and replaces only the text before them, so the Markdown mustn't repeat ${quoted(repeated)}. Leave it out, or replace that subsection with its own replace_section`,
        ]
      : [];
  },
  report: (current, input) => {
    const document = current ?? EMPTY;
    const section = findSection(document, input.heading);
    if (!section) {
      return [];
    }
    const blocks = blocksOf(input.content);
    const [old] = headingsOf(
      document.content.slice(section.start, section.start + 1)
    );
    const kept = subsectionsOf(document, section);
    const [first, ...rest] = headingsOf(blocks);
    const leadsWithHeading = blocks[0]?.type === "heading";
    const added = leadsWithHeading ? rest : headingsOf(blocks);
    const renamed =
      leadsWithHeading && normalise(first ?? "") !== normalise(old ?? "");
    return [
      ...sameNamed(document, input.heading),
      renamed
        ? `Replaced the heading "${old}" with "${first}", and the text under it.`
        : `Replaced the text under "${old}".`,
      ...(added.length > 0 ? [`Added the headings ${quoted(added)}.`] : []),
      ...(kept.length > 0
        ? [`Kept the subsections under it: ${quoted(kept)}.`]
        : []),
    ];
  },
});

/**
 * Where `insert` puts `blocks`: right after the heading, at the end of the
 * body (before any subsection, so text doesn't land under one), or, for
 * blocks that start a section of their own, after the whole section.
 */
const insertAt = (
  section: DocumentSection,
  position: "section_end" | "section_start" | undefined,
  blocks: readonly DocumentBlock[]
): number => {
  if (position === "section_start") {
    return section.start + 1;
  }
  return blocks[0]?.type === "heading" ? section.end : section.bodyEnd;
};

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
    const at = insertAt(section, input.position, blocks);
    return withBlocks(document, at, at, blocks);
  },
  description:
    "Insert Markdown blocks right after a heading (section_start) or at the end of its section (section_end, the default): text goes before its subsections, and Markdown that starts with a heading goes after them. Without a heading, at the end of the document.",
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
  report: (current, input) => {
    const document = current ?? EMPTY;
    const added = headingsOf(blocksOf(input.content));
    const addedSentence =
      added.length > 0 ? [`Added the headings ${quoted(added)}.`] : [];
    const section =
      input.heading === undefined ? null : findSection(document, input.heading);
    if (!section) {
      return ["Added it at the end of the document.", ...addedSentence];
    }
    const subsections = subsectionsOf(document, section);
    const named = `"${input.heading}"`;
    const where = (): string => {
      if (input.position === "section_start") {
        return `right after the heading ${named}`;
      }
      if (blocksOf(input.content)[0]?.type === "heading") {
        return subsections.length > 0
          ? `after the section ${named} and its subsections`
          : `after the section ${named}`;
      }
      return subsections.length > 0
        ? `at the end of the text under ${named}, before its subsections ${quoted(subsections)}`
        : `at the end of the text under ${named}`;
    };
    return [
      ...sameNamed(document, input.heading ?? ""),
      `Added it ${where()}.`,
      ...addedSentence,
    ];
  },
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
  description:
    "Delete a section: its heading and everything under it, its subsections included.",
  input: z.object({ heading: headingInput }),
  problems: (current, input) =>
    current && findSection(current, input.heading)
      ? []
      : [noSection(current ?? EMPTY, input.heading)],
  report: (current, input) => {
    const document = current ?? EMPTY;
    const section = findSection(document, input.heading);
    if (!section) {
      return [];
    }
    const subsections = subsectionsOf(document, section);
    return [
      ...sameNamed(document, input.heading),
      subsections.length > 0
        ? `Deleted "${input.heading}" and the subsections under it: ${quoted(subsections)}.`
        : `Deleted "${input.heading}".`,
    ];
  },
});

/** The structured edits the model may make, by the name it calls them. */
export const DOCUMENT_EDITS = {
  delete_section: deleteSection,
  insert: insertBlocks,
  replace_section: replaceSection,
} as const;

export type DocumentEditName = keyof typeof DOCUMENT_EDITS;

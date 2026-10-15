import { sizeLimit } from "../../checks";
import { defineArtifactKind } from "../../define";
import { DOCUMENT_MAX_CHARS, safeUrls } from "./checks";
import { documentToMarkdown, markdownToDocument } from "./markdown";
import {
  deleteSection,
  insertBlocks,
  replaceDocument,
  replaceSection,
} from "./operations";
import {
  type Document,
  documentContentSchema,
  documentSchema,
  serializeDocument,
} from "./schema";

// The Document kind (126): rich text a person edits in a full-page TipTap
// editor and the model edits a section at a time. A version stores the
// editor's JSON; the model reads and writes Markdown, converted on the way
// in and out (`modelText`), so it never has to produce ProseMirror JSON.

const DOC_JSON = /^\s*\{[\s\S]*"type"\s*:\s*"doc"/;

/**
 * The model's text as a document: Markdown, or (if a model sends it) the
 * editor's own JSON, used as is when it parses.
 */
export const documentFromModel = (text: string): Document => {
  if (DOC_JSON.test(text)) {
    try {
      const parsed = documentSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Not JSON after all: read it as Markdown.
    }
  }
  return markdownToDocument(text);
};

/** What the model is told about documents, after the artifacts fragment. */
export const DOCUMENT_INSTRUCTIONS = `Documents (create_artifact type "document") are rich text the user can edit in a full-page editor and export to Word, PDF or Markdown. Prefer them for reports, plans, briefs, notes and anything the user will keep editing; use "markdown" only for text that is just read.

Write a document's content as Markdown: headings (#, ##, ###), paragraphs, bullet and numbered lists, task lists (- [ ] and - [x]), tables, block quotes, code blocks, links, and images by https URL. It is stored as rich text, so raw HTML is dropped.

To change part of a document, call update_artifact with \`edit\` instead of \`content\`:
- replace_section: the section under a heading (up to the next heading of the same or a higher level). Start the Markdown with a heading to rename it; otherwise the heading stays.
- insert: blocks at a heading's section_start or section_end, or at the end of the document without a heading.
- delete_section: a heading and everything under it.
Name sections by their heading text. Send the whole \`content\` only to rewrite most of the document. The user may have edited it since you wrote it: edit the latest version you were shown.`;

export const documentKind = defineArtifactKind<Document>({
  capabilities: {
    aiCalls: false,
    annotate: false,
    present: false,
    share: false,
  },
  checks: [
    sizeLimit({ chars: DOCUMENT_MAX_CHARS, of: serializeDocument }),
    safeUrls,
  ],
  content: documentContentSchema,
  diff: "text",
  editor: "rich-text",
  export: [
    { extension: "md", format: "file" },
    { extension: "pdf", format: "file" },
    { extension: "docx", format: "file" },
  ],
  icon: "FileTextIcon",
  instructions: DOCUMENT_INSTRUCTIONS,
  kind: "document",
  label: "Document",
  modelText: {
    fromModel: documentFromModel,
    serialize: serializeDocument,
    toModel: documentToMarkdown,
  },
  operations: {
    delete_section: deleteSection,
    insert: insertBlocks,
    replace: replaceDocument,
    replace_section: replaceSection,
  },
  render: { panel: "document", runtime: null },
  starter: {},
  thumbnail: "none",
});

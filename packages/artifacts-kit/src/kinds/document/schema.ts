import { z } from "zod";

// A document's content (126): the TipTap (ProseMirror) JSON the editor
// reads and writes, as zod. The node and mark names are the ones the
// editor's extensions use (StarterKit, task lists, tables and images), so
// what the editor saves parses here and what parses here loads in the
// editor. Attributes are loose objects: the attributes that matter are
// checked, and ones an extension adds (`textAlign`, a link's `rel`) pass.
//
// A version stores the JSON as text; `documentContentSchema` reads it.

/** A mark on a run of text. */
export const documentMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("code") }),
  z.object({
    attrs: z.looseObject({
      href: z.string().max(4096),
      title: z.string().max(500).nullish(),
    }),
    type: z.literal("link"),
  }),
]);
export type DocumentMark = z.infer<typeof documentMarkSchema>;

export const documentTextSchema = z.object({
  marks: z.array(documentMarkSchema).optional(),
  text: z.string().min(1),
  type: z.literal("text"),
});
export type DocumentText = z.infer<typeof documentTextSchema>;

export const documentInlineSchema = z.discriminatedUnion("type", [
  documentTextSchema,
  z.object({
    marks: z.array(documentMarkSchema).optional(),
    type: z.literal("hardBreak"),
  }),
]);
export type DocumentInline = z.infer<typeof documentInlineSchema>;

const inlineContent = z.array(documentInlineSchema).optional();
const anyAttrs = z.looseObject({}).optional();

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const documentParagraphSchema = z.object({
  attrs: anyAttrs,
  content: inlineContent,
  type: z.literal("paragraph"),
});
export type DocumentParagraph = z.infer<typeof documentParagraphSchema>;

export const documentHeadingSchema = z.object({
  attrs: z.looseObject({ level: z.int().min(1).max(6) }),
  content: inlineContent,
  type: z.literal("heading"),
});
export type DocumentHeading = z.infer<typeof documentHeadingSchema>;

const codeBlockSchema = z.object({
  attrs: z.looseObject({ language: z.string().max(64).nullish() }).optional(),
  content: z.array(documentTextSchema.omit({ marks: true })).optional(),
  type: z.literal("codeBlock"),
});

const horizontalRuleSchema = z.object({
  attrs: anyAttrs,
  type: z.literal("horizontalRule"),
});

export const documentImageSchema = z.object({
  attrs: z.looseObject({
    alt: z.string().max(1000).nullish(),
    src: z.string().min(1).max(4096),
    title: z.string().max(1000).nullish(),
  }),
  type: z.literal("image"),
});

const cellAttrs = z
  .looseObject({
    colspan: z.int().min(1).max(100).optional(),
    colwidth: z.array(z.number()).nullish(),
    rowspan: z.int().min(1).max(1000).optional(),
  })
  .optional();

// Containers hold blocks, so they're recursive: each `content` is a getter
// (zod 4's way of referring to a schema defined below it).

export const documentListItemSchema = z.object({
  attrs: anyAttrs,
  get content() {
    return z.array(documentBlockSchema).min(1);
  },
  type: z.literal("listItem"),
});

export const documentTaskItemSchema = z.object({
  attrs: z.looseObject({ checked: z.boolean().optional() }).optional(),
  get content() {
    return z.array(documentBlockSchema).min(1);
  },
  type: z.literal("taskItem"),
});

const tableCellSchema = z.object({
  attrs: cellAttrs,
  get content() {
    return z.array(documentBlockSchema).min(1);
  },
  type: z.enum(["tableCell", "tableHeader"]),
});

const tableRowSchema = z.object({
  attrs: anyAttrs,
  content: z.array(tableCellSchema).min(1),
  type: z.literal("tableRow"),
});

const tableSchema = z.object({
  attrs: anyAttrs,
  content: z.array(tableRowSchema).min(1),
  type: z.literal("table"),
});

const blockquoteSchema = z.object({
  attrs: anyAttrs,
  get content() {
    return z.array(documentBlockSchema).min(1);
  },
  type: z.literal("blockquote"),
});

const bulletListSchema = z.object({
  attrs: anyAttrs,
  content: z.array(documentListItemSchema).min(1),
  type: z.literal("bulletList"),
});

const orderedListSchema = z.object({
  attrs: z.looseObject({ start: z.int().min(0).nullish() }).optional(),
  content: z.array(documentListItemSchema).min(1),
  type: z.literal("orderedList"),
});

const taskListSchema = z.object({
  attrs: anyAttrs,
  content: z.array(documentTaskItemSchema).min(1),
  type: z.literal("taskList"),
});

/** Every block a document can hold, at the top level or inside a container. */
export const documentBlockSchema = z.discriminatedUnion("type", [
  documentParagraphSchema,
  documentHeadingSchema,
  blockquoteSchema,
  bulletListSchema,
  orderedListSchema,
  taskListSchema,
  codeBlockSchema,
  horizontalRuleSchema,
  documentImageSchema,
  tableSchema,
]);
export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type DocumentListItem = z.infer<typeof documentListItemSchema>;
export type DocumentTaskItem = z.infer<typeof documentTaskItemSchema>;
export type DocumentTableCell = z.infer<typeof tableCellSchema>;
export type DocumentTableRow = z.infer<typeof tableRowSchema>;

/** A whole document: the editor's `doc` node. */
export const documentSchema = z.object({
  content: z.array(documentBlockSchema),
  type: z.literal("doc"),
});
export type Document = z.infer<typeof documentSchema>;

/** The empty document an editor starts from. */
export const EMPTY_DOCUMENT: Document = {
  content: [{ type: "paragraph" }],
  type: "doc",
};

/**
 * A version's stored text, read as a document: JSON, then the shape. Bad
 * JSON is one issue ("content isn't a document's JSON"), not a stack.
 */
export const documentContentSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: "isn't a document's JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(documentSchema);

/** A document as a version stores it. */
export const serializeDocument = (document: Document): string =>
  JSON.stringify(document);

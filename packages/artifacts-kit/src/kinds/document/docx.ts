import {
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import type {
  Document,
  DocumentBlock,
  DocumentInline,
  DocumentText,
} from "./schema";

// A document as a Word file (126), built in the browser (or anywhere) with
// the `docx` library: headings, lists (bulleted, numbered and checklists),
// tables, quotes, code and links. Images are linked rather than embedded,
// since embedding would mean fetching them. Only the export menu imports
// this module, so the server never loads `docx`.

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const MONO = "Courier New";
const NUMBERED = "numbered";
/** Word's half-points per level of list indent. */
const INDENT_STEP = 360;

interface Context {
  /** Each numbered list gets its own numbering instance, so it restarts. */
  instance: number;
  readonly level: number;
  readonly quote: boolean;
}

const runOf = (node: DocumentText, quote: boolean): TextRun => {
  const marks = new Set((node.marks ?? []).map((mark) => mark.type));
  return new TextRun({
    bold: marks.has("bold"),
    font: marks.has("code") ? MONO : undefined,
    italics: marks.has("italic") || quote,
    strike: marks.has("strike"),
    text: node.text,
    underline: marks.has("underline") ? {} : undefined,
  });
};

const inlineChildren = (
  nodes: readonly DocumentInline[] | undefined,
  quote: boolean
): ParagraphChild[] =>
  (nodes ?? []).map((node): ParagraphChild => {
    if (node.type === "hardBreak") {
      return new TextRun({ break: 1 });
    }
    const link = node.marks?.find((mark) => mark.type === "link");
    const run = runOf(node, quote);
    return link
      ? new ExternalHyperlink({
          children: [
            new TextRun({
              bold: node.marks?.some((mark) => mark.type === "bold"),
              italics: quote,
              style: "Hyperlink",
              text: node.text,
            }),
          ],
          link: link.attrs.href,
        })
      : run;
  });

const plainText = (nodes: readonly DocumentInline[] | undefined): string =>
  (nodes ?? [])
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");

/** Blocks inside a list item: its first paragraph carries the bullet or number. */
const listItem = (
  blocks: readonly DocumentBlock[],
  context: Context,
  marker: (
    first: boolean
  ) => Partial<ConstructorParameters<typeof Paragraph>[0] & object>,
  prefix?: string
): (Paragraph | Table)[] =>
  blocks.flatMap((block, index) => {
    if (block.type === "paragraph") {
      const children = inlineChildren(block.content, context.quote);
      return [
        new Paragraph({
          children:
            prefix && index === 0
              ? [new TextRun({ text: prefix }), ...children]
              : children,
          ...(index === 0
            ? marker(true)
            : { indent: { left: INDENT_STEP * (context.level + 1) } }),
        }),
      ];
    }
    return blockOf(block, { ...context, level: context.level + 1 });
  });

const blockOf = (
  block: DocumentBlock,
  context: Context
): (Paragraph | Table)[] => {
  const quoteIndent = context.quote ? { indent: { left: INDENT_STEP } } : {};
  switch (block.type) {
    case "paragraph":
      return [
        new Paragraph({
          children: inlineChildren(block.content, context.quote),
          ...quoteIndent,
        }),
      ];
    case "heading":
      return [
        new Paragraph({
          children: inlineChildren(block.content, false),
          heading: HEADINGS[block.attrs.level - 1] ?? HeadingLevel.HEADING_6,
        }),
      ];
    case "blockquote":
      return block.content.flatMap((inner) =>
        blockOf(inner, { ...context, quote: true })
      );
    case "bulletList":
      return block.content.flatMap((item) =>
        listItem(item.content, context, () => ({
          bullet: { level: Math.min(8, context.level) },
        }))
      );
    case "orderedList": {
      context.instance += 1;
      const { instance } = context;
      return block.content.flatMap((item) =>
        listItem(item.content, context, () => ({
          numbering: {
            instance,
            level: Math.min(8, context.level),
            reference: NUMBERED,
          },
        }))
      );
    }
    case "taskList":
      return block.content.flatMap((item) =>
        listItem(
          item.content,
          context,
          () => ({ indent: { left: INDENT_STEP * (context.level + 1) } }),
          item.attrs?.checked ? "☑ " : "☐ "
        )
      );
    case "codeBlock":
      return (plainText(block.content) || " ").split("\n").map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ font: MONO, text: line })],
            ...quoteIndent,
          })
      );
    case "horizontalRule":
      return [
        new Paragraph({
          border: { bottom: { size: 6, space: 1, style: "single" } },
          children: [],
        }),
      ];
    case "image": {
      const label = block.attrs.alt || block.attrs.title || block.attrs.src;
      return [
        new Paragraph({
          children: [
            new ExternalHyperlink({
              children: [new TextRun({ style: "Hyperlink", text: label })],
              link: block.attrs.src,
            }),
          ],
        }),
      ];
    }
    case "table": {
      const width = Math.max(...block.content.map((row) => row.content.length));
      return [
        new Table({
          columnWidths: new Array<number>(width).fill(
            Math.floor(9000 / Math.max(1, width))
          ),
          rows: block.content.map(
            (row) =>
              new TableRow({
                children: row.content.map(
                  (cell) =>
                    new TableCell({
                      children: cell.content.flatMap((inner) =>
                        blockOf(inner, { ...context, level: 0 })
                      ),
                      columnSpan: cell.attrs?.colspan,
                      rowSpan: cell.attrs?.rowspan,
                    })
                ),
                tableHeader: row.content.every(
                  (cell) => cell.type === "tableHeader"
                ),
              })
          ),
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      ];
    }
    default:
      return block satisfies never;
  }
};

/** The `docx` document for `document`, titled `title`. Pure; `Packer` writes it. */
export const documentToDocx = (
  document: Document,
  title: string
): DocxDocument => {
  const context: Context = { instance: 0, level: 0, quote: false };
  return new DocxDocument({
    numbering: {
      config: [
        {
          levels: Array.from({ length: 9 }, (_, level) => ({
            alignment: "left" as const,
            format: LevelFormat.DECIMAL,
            level,
            style: {
              paragraph: {
                indent: {
                  hanging: INDENT_STEP / 2,
                  left: INDENT_STEP * (level + 1),
                },
              },
            },
            text: `%${level + 1}.`,
          })),
          reference: NUMBERED,
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, text: title }),
          ...document.content.flatMap((block) => blockOf(block, context)),
        ],
      },
    ],
    title,
  });
};

/** The Word file's bytes, as a Blob (browser) for a download. */
export const documentToDocxBlob = (
  document: Document,
  title: string
): Promise<Blob> => Packer.toBlob(documentToDocx(document, title));

/** The Word file's bytes, for tests and anything without a Blob. */
export const documentToDocxBuffer = (
  document: Document,
  title: string
): Promise<Uint8Array> => Packer.toBuffer(documentToDocx(document, title));

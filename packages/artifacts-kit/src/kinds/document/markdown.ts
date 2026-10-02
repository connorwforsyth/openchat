import { Lexer, type Token, type Tokens } from "marked";

import type {
  Document,
  DocumentBlock,
  DocumentInline,
  DocumentMark,
  DocumentTableCell,
  DocumentTaskItem,
  DocumentText,
} from "./schema";

// Markdown in and out of a document (126). The model writes Markdown, which
// it's fluent in, and a document stores the editor's JSON; these convert
// between the two. Reading uses marked's lexer (GitHub-flavoured: tables,
// task lists, strikethrough) and builds nodes from its tokens; writing is a
// small serializer. Both are pure. What Markdown can't say (underline, a
// cell's width) is dropped on the way out, never invented on the way in.

type Mark = DocumentMark;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;
const TAG = /<[^>]*>/g;
const SOFT_BREAK = /[ \t]*\n[ \t]*/g;
const WHITESPACE = /\s/;
const LEADING_SPACE = /^\s*/;
const TRAILING_SPACE = /\s*$/;
const NUMBER_END = /([.)])$/;

/** Marked leaves character references as written; text in a document has them read. */
const decodeEntities = (text: string): string =>
  text.replace(ENTITY, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10_ff_ff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

const textNode = (text: string, marks: readonly Mark[]): DocumentText =>
  marks.length > 0
    ? { marks: [...marks], text, type: "text" }
    : { text, type: "text" };

/** Inline tokens as text and breaks, carrying the marks around them. */
const inlineNodes = (
  tokens: readonly Token[] | undefined,
  marks: readonly Mark[] = []
): DocumentInline[] => {
  const out: DocumentInline[] = [];
  for (const token of tokens ?? []) {
    out.push(...inlineNode(token, marks));
  }
  return mergeText(out);
};

const inlineNode = (
  token: Token,
  marks: readonly Mark[]
): readonly DocumentInline[] => {
  switch (token.type) {
    case "text":
    case "escape": {
      const nested = (token as Tokens.Text).tokens;
      if (nested && nested.length > 0) {
        return inlineNodes(nested, marks);
      }
      const text = decodeEntities(token.text).replace(SOFT_BREAK, " ");
      return text === "" ? [] : [textNode(text, marks)];
    }
    case "strong":
      return inlineNodes(token.tokens, [...marks, { type: "bold" }]);
    case "em":
      return inlineNodes(token.tokens, [...marks, { type: "italic" }]);
    case "del":
      return inlineNodes(token.tokens, [...marks, { type: "strike" }]);
    case "codespan": {
      const text = decodeEntities(token.text);
      return text === "" ? [] : [textNode(text, [...marks, { type: "code" }])];
    }
    case "link": {
      const link = token as Tokens.Link;
      return inlineNodes(link.tokens, [
        ...marks,
        {
          attrs: { href: link.href, title: link.title ?? null },
          type: "link",
        },
      ]);
    }
    case "br":
      return [{ type: "hardBreak" }];
    case "html": {
      // Tags are dropped; their text stays.
      const text = decodeEntities(token.text.replace(TAG, ""));
      return text === "" ? [] : [textNode(text, marks)];
    }
    case "image": {
      // Only reached inside a link or a heading; blocks split images out.
      const text = decodeEntities((token as Tokens.Image).text);
      return text === "" ? [] : [textNode(text, marks)];
    }
    default:
      return "text" in token && typeof token.text === "string"
        ? [textNode(decodeEntities(token.text), marks)]
        : [];
  }
};

const sameMarks = (
  a: readonly Mark[] | undefined,
  b: readonly Mark[] | undefined
): boolean => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Neighbouring text with the same marks as one node, as the editor keeps it. */
const mergeText = (nodes: readonly DocumentInline[]): DocumentInline[] => {
  const out: DocumentInline[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (
      node.type === "text" &&
      last?.type === "text" &&
      sameMarks(last.marks, node.marks)
    ) {
      out[out.length - 1] = { ...last, text: last.text + node.text };
    } else {
      out.push(node);
    }
  }
  return out;
};

const paragraph = (content: readonly DocumentInline[]): DocumentBlock =>
  content.length > 0
    ? { content: [...content], type: "paragraph" }
    : { type: "paragraph" };

/**
 * A paragraph's tokens as blocks: a document's images are blocks of their
 * own, so a paragraph with images splits around them.
 */
const paragraphBlocks = (tokens: readonly Token[]): DocumentBlock[] => {
  const blocks: DocumentBlock[] = [];
  let run: Token[] = [];
  const flush = () => {
    const content = trimBreaks(inlineNodes(run));
    if (content.length > 0) {
      blocks.push(paragraph(content));
    }
    run = [];
  };
  for (const token of tokens) {
    if (token.type === "image") {
      flush();
      const image = token as Tokens.Image;
      blocks.push({
        attrs: {
          alt: decodeEntities(image.text) || null,
          src: image.href,
          title: image.title ?? null,
        },
        type: "image",
      });
    } else {
      run.push(token);
    }
  }
  flush();
  return blocks.length > 0 ? blocks : [paragraph([])];
};

/** Leading and trailing spaces and breaks, which split images leave behind. */
const trimBreaks = (nodes: DocumentInline[]): DocumentInline[] => {
  const out = [...nodes];
  while (out[0]?.type === "hardBreak") {
    out.shift();
  }
  while (out.at(-1)?.type === "hardBreak") {
    out.pop();
  }
  const [first] = out;
  if (first?.type === "text") {
    const text = first.text.trimStart();
    if (text === "") {
      out.shift();
    } else {
      out[0] = { ...first, text };
    }
  }
  const last = out.at(-1);
  if (last?.type === "text") {
    const text = last.text.trimEnd();
    if (text === "") {
      out.pop();
    } else {
      out[out.length - 1] = { ...last, text };
    }
  }
  return out;
};

/** A list item's own tokens as the blocks it holds. */
const itemBlocks = (item: Tokens.ListItem): DocumentBlock[] => {
  const blocks = blockNodes(
    item.tokens.filter((token) => token.type !== "checkbox")
  );
  // The editor's list items start with a paragraph.
  return blocks[0]?.type === "paragraph" ? blocks : [paragraph([]), ...blocks];
};

const listBlock = (list: Tokens.List): DocumentBlock => {
  if (list.items.some((item) => item.task)) {
    return {
      content: list.items.map(
        (item): DocumentTaskItem => ({
          attrs: { checked: item.checked === true },
          content: itemBlocks(item),
          type: "taskItem",
        })
      ),
      type: "taskList",
    };
  }
  const content = list.items.map((item) => ({
    content: itemBlocks(item),
    type: "listItem" as const,
  }));
  if (!list.ordered) {
    return { content, type: "bulletList" };
  }
  const start = typeof list.start === "number" ? list.start : 1;
  return { attrs: { start }, content, type: "orderedList" };
};

const cell = (
  token: Tokens.TableCell,
  type: DocumentTableCell["type"]
): DocumentTableCell => ({
  content: [paragraph(trimBreaks(inlineNodes(token.tokens)))],
  type,
});

const tableBlock = (table: Tokens.Table): DocumentBlock => ({
  content: [
    {
      content: table.header.map((each) => cell(each, "tableHeader")),
      type: "tableRow",
    },
    ...table.rows.map((row) => ({
      content: row.map((each) => cell(each, "tableCell")),
      type: "tableRow" as const,
    })),
  ],
  type: "table",
});

const blockNode = (token: Token): readonly DocumentBlock[] => {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      return [
        {
          attrs: { level: Math.min(6, Math.max(1, heading.depth)) },
          content: trimBreaks(inlineNodes(heading.tokens)),
          type: "heading",
        },
      ];
    }
    case "paragraph":
      return paragraphBlocks(token.tokens ?? []);
    case "text": {
      // A tight list item's text.
      const text = token as Tokens.Text;
      return paragraphBlocks(
        text.tokens ?? [{ raw: text.raw, text: text.text, type: "text" }]
      );
    }
    case "list":
      return [listBlock(token as Tokens.List)];
    case "blockquote": {
      const inner = blockNodes((token as Tokens.Blockquote).tokens);
      return [
        {
          content: inner.length > 0 ? inner : [paragraph([])],
          type: "blockquote",
        },
      ];
    }
    case "code": {
      const code = token as Tokens.Code;
      return [
        {
          attrs: { language: code.lang?.split(WHITESPACE)[0] || null },
          ...(code.text === ""
            ? {}
            : { content: [{ text: code.text, type: "text" as const }] }),
          type: "codeBlock",
        },
      ];
    }
    case "hr":
      return [{ type: "horizontalRule" }];
    case "table":
      return [tableBlock(token as Tokens.Table)];
    case "html": {
      const text = decodeEntities(token.text.replace(TAG, "")).trim();
      return text === "" ? [] : [paragraph([textNode(text, [])])];
    }
    case "space":
    case "def":
    case "checkbox":
      return [];
    default:
      return [];
  }
};

const blockNodes = (tokens: readonly Token[]): DocumentBlock[] =>
  tokens.flatMap((token) => [...blockNode(token)]);

/** Markdown as a document. Anything is Markdown, so this never fails. Pure. */
export const markdownToDocument = (markdown: string): Document => {
  const content = blockNodes(new Lexer({ gfm: true }).lex(markdown));
  return {
    content: content.length > 0 ? content : [paragraph([])],
    type: "doc",
  };
};

// --- Out ---

const INLINE_SPECIAL = /[\\`*_[\]~<]/g;
const LINE_START_SPECIAL = /^(\s*)([#>+-]|\d+[.)])(?=\s|$)/;
const BACKTICKS = /`+/g;

/** Text as Markdown would read it back: specials escaped, line starts too. */
const escapeText = (text: string): string =>
  text.replace(INLINE_SPECIAL, (char) => `\\${char}`);

/** A code span that holds `text`, whatever backticks it has. */
const codeSpan = (text: string): string => {
  const longest = Math.max(
    0,
    ...[...text.matchAll(BACKTICKS)].map((m) => m[0].length)
  );
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
};

const MARK_ORDER: readonly Mark["type"][] = [
  "link",
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
];

const wrap = (mark: Mark, inner: string): string => {
  switch (mark.type) {
    case "bold":
      return `**${inner}**`;
    case "italic":
      return `*${inner}*`;
    case "strike":
      return `~~${inner}~~`;
    case "underline":
      // Markdown has no underline; the words stay.
      return inner;
    case "code":
      return inner;
    case "link": {
      const title = mark.attrs.title
        ? ` "${mark.attrs.title.replaceAll('"', '\\"')}"`
        : "";
      return `[${inner}](${mark.attrs.href.replaceAll(" ", "%20").replaceAll(")", "%29")}${title})`;
    }
    default:
      return mark satisfies never;
  }
};

const textMarkdown = (node: DocumentText): string => {
  const marks = [...(node.marks ?? [])].sort(
    (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type)
  );
  const isCode = marks.some((mark) => mark.type === "code");
  // Emphasis can't start or end on a space in Markdown: keep spaces outside.
  const leading = isCode ? "" : (LEADING_SPACE.exec(node.text)?.[0] ?? "");
  const trailing = isCode ? "" : (TRAILING_SPACE.exec(node.text)?.[0] ?? "");
  const core = node.text.slice(
    leading.length,
    node.text.length - trailing.length
  );
  if (core === "") {
    return node.text;
  }
  let out = isCode ? codeSpan(core) : escapeText(core);
  for (const mark of marks) {
    out = wrap(mark, out);
  }
  return `${leading}${out}${trailing}`;
};

const inlineMarkdown = (nodes: readonly DocumentInline[] | undefined): string =>
  (nodes ?? [])
    .map((node) => (node.type === "text" ? textMarkdown(node) : "\\\n"))
    .join("");

/** A paragraph's first line can't read as a heading, list or quote. */
const guardLineStart = (text: string): string =>
  text.replace(LINE_START_SPECIAL, (_whole, space: string, marker: string) =>
    marker.length === 1
      ? `${space}\\${marker}`
      : `${space}${marker.replace(NUMBER_END, "\\$1")}`
  );

const indent = (text: string, by: string): string =>
  text
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : by + line))
    .join("\n");

const listItemMarkdown = (
  blocks: readonly DocumentBlock[],
  marker: string
): string =>
  `${marker}${indent(blocksMarkdown(blocks, "\n"), " ".repeat(marker.length))}`;

const cellMarkdown = (tableCell: DocumentTableCell): string =>
  tableCell.content
    .map((block) =>
      block.type === "paragraph" || block.type === "heading"
        ? inlineMarkdown(block.content).replaceAll("\\\n", " ")
        : blockMarkdown(block).replaceAll("\n", " ")
    )
    .join(" ")
    .replaceAll("|", "\\|");

const blockMarkdown = (block: DocumentBlock): string => {
  switch (block.type) {
    case "paragraph":
      return guardLineStart(inlineMarkdown(block.content));
    case "heading":
      return `${"#".repeat(block.attrs.level)} ${inlineMarkdown(block.content)}`;
    case "blockquote":
      return blocksMarkdown(block.content)
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "bulletList":
      return block.content
        .map((item) => listItemMarkdown(item.content, "- "))
        .join("\n");
    case "orderedList": {
      const start = block.attrs?.start ?? 1;
      return block.content
        .map((item, index) =>
          listItemMarkdown(item.content, `${start + index}. `)
        )
        .join("\n");
    }
    case "taskList":
      return block.content
        .map((item) =>
          listItemMarkdown(
            item.content,
            item.attrs?.checked ? "- [x] " : "- [ ] "
          )
        )
        .join("\n");
    case "codeBlock": {
      const text = (block.content ?? []).map((node) => node.text).join("");
      const longest = Math.max(
        2,
        ...[...text.matchAll(BACKTICKS)].map((m) => m[0].length)
      );
      const fence = "`".repeat(longest + 1);
      return `${fence}${block.attrs?.language ?? ""}\n${text}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const { alt, src, title } = block.attrs;
      const titled = title ? ` "${title.replaceAll('"', '\\"')}"` : "";
      return `![${escapeText(alt ?? "")}](${src.replaceAll(" ", "%20")}${titled})`;
    }
    case "table": {
      const [head, ...rows] = block.content;
      if (!head) {
        return "";
      }
      const width = Math.max(...block.content.map((row) => row.content.length));
      const line = (cells: readonly string[]) =>
        `| ${[...cells, ...new Array<string>(width - cells.length).fill("")].join(" | ")} |`;
      return [
        line(head.content.map(cellMarkdown)),
        line(new Array<string>(width).fill("---")),
        ...rows.map((row) => line(row.content.map(cellMarkdown))),
      ].join("\n");
    }
    default:
      return block satisfies never;
  }
};

const blocksMarkdown = (
  blocks: readonly DocumentBlock[],
  separator = "\n\n"
): string => {
  // Two lists in a row would read back as one; a comment keeps them apart.
  const parts: string[] = [];
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    const isList = (type: string | undefined) =>
      type === "bulletList" || type === "orderedList" || type === "taskList";
    if (index > 0 && isList(block.type) && isList(previous?.type)) {
      parts.push("<!-- -->");
    }
    parts.push(blockMarkdown(block));
  });
  return parts.join(separator);
};

/** A document as Markdown, for the model and for export. Pure. */
export const documentToMarkdown = (document: Document): string => {
  const text = blocksMarkdown(document.content).trim();
  return text === "" ? "" : `${text}\n`;
};

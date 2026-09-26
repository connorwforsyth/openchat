import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import type { DocumentPage } from "./chunk";

// Parsing, in-process (PLAN.md §8 RAG step 2): PDF with unpdf, DOCX with
// mammoth, and anything textual (plain text, Markdown, code, data formats)
// decoded as UTF-8. Both parsers load lazily, so a chat that never sees a
// PDF never pays for pdf.js. Output is Markdown-ish text, so the chunker can
// keep headings; code is fenced, so a `# comment` isn't mistaken for one.

export const documentFormatSchema = z.enum(["pdf", "docx", "text", "code"]);
export type DocumentFormat = z.infer<typeof documentFormatSchema>;

export interface ParsedDocument {
  readonly format: DocumentFormat;
  readonly pages: readonly DocumentPage[];
}

export const parseErrorSchema = z.discriminatedUnion("type", [
  /** Not a format we can read text from (images, archives, …). */
  z.object({ mediaType: z.string(), type: z.literal("unsupported") }),
  /** The right format, but broken or encrypted. Safe to show. */
  z.object({ message: z.string(), type: z.literal("invalid") }),
]);
export type ParseError = z.infer<typeof parseErrorSchema>;

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Non-`text/*` types that are text all the same. */
const TEXT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-ndjson",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/sql",
  "application/graphql",
]);

const PROSE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "rst",
  "adoc",
  "org",
  "csv",
  "tsv",
  "log",
]);

/** Extension to the fence language, for code the browser labelled octet-stream. */
const CODE_EXTENSIONS: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "js",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  lua: "lua",
  mjs: "js",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "sh",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

const baseType = (mediaType: string): string =>
  mediaType.split(";")[0]?.trim().toLowerCase() ?? "";

type Reader =
  | { readonly kind: "pdf" | "docx" | "prose" }
  | { readonly kind: "code"; readonly language: string };

const readerFor = (mediaType: string, name: string): Reader | null => {
  const type = baseType(mediaType);
  const extension = extensionOf(name);
  if (type === PDF || extension === "pdf") {
    return { kind: "pdf" };
  }
  if (type === DOCX || extension === "docx") {
    return { kind: "docx" };
  }
  const language = CODE_EXTENSIONS[extension];
  if (language) {
    return { kind: "code", language };
  }
  if (
    PROSE_EXTENSIONS.has(extension) ||
    type.startsWith("text/") ||
    TEXT_TYPES.has(type)
  ) {
    return { kind: "prose" };
  }
  return null;
};

/** Whether `parseDocument` can read text from this file; decides if it's indexed. */
export const isParseable = (mediaType: string, name: string): boolean =>
  readerFor(mediaType, name) !== null;

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    // A leading BOM is decoded away by default.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const decodeEntities = (text: string): string =>
  text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    }
    return ENTITIES[body.toLowerCase()] ?? entity;
  });

const stripTags = (html: string): string =>
  decodeEntities(html.replaceAll(/<[^>]+>/g, "")).trim();

/**
 * mammoth's HTML as Markdown-ish text: headings become `#` lines (the
 * chunker's section breaks), list items `- ` lines, table cells `|`-joined.
 * mammoth's output is a small, known subset of HTML, so regexes suffice.
 */
export const docxHtmlToText = (html: string): string =>
  html
    .replaceAll(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, level: string, inner: string) =>
        `\n\n${"#".repeat(Number(level))} ${stripTags(inner)}\n\n`
    )
    .replaceAll(
      /<li[^>]*>([\s\S]*?)<\/li>/gi,
      (_, inner: string) => `\n- ${stripTags(inner)}`
    )
    .replaceAll(/<\/t[dh]>/gi, " | ")
    .replaceAll(/<\/tr>/gi, "\n")
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<\/(p|ul|ol|table)>/gi, "\n\n")
    .split("\n")
    .map((line) => stripTags(line))
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();

const parsePdf = async (
  bytes: Uint8Array
): AsyncResult<ParsedDocument, ParseError> => {
  try {
    const { extractText } = await import("unpdf");
    // pdf.js may transfer the buffer to a worker; give it a copy.
    const { text } = await extractText(bytes.slice(), { mergePages: false });
    return ok({
      format: "pdf",
      pages: text.map((pageText, index) => ({
        page: index + 1,
        text: pageText,
      })),
    });
  } catch {
    return err({
      message:
        "The PDF couldn't be read. It may be damaged or password-protected.",
      type: "invalid",
    });
  }
};

const parseDocx = async (
  bytes: Uint8Array
): AsyncResult<ParsedDocument, ParseError> => {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({
      buffer: Buffer.from(bytes),
    });
    return ok({
      format: "docx",
      pages: [{ page: null, text: docxHtmlToText(value) }],
    });
  } catch {
    return err({
      message: "The Word document couldn't be read. It may be damaged.",
      type: "invalid",
    });
  }
};

const notUtf8 = () =>
  err({
    message: "The file isn't valid UTF-8 text.",
    type: "invalid" as const,
  });

/** The text of a file, by media type with the file name's extension as a fallback. */
export const parseDocument = (
  bytes: Uint8Array,
  { mediaType, name }: { readonly mediaType: string; readonly name: string }
): AsyncResult<ParsedDocument, ParseError> => {
  const reader = readerFor(mediaType, name);
  if (!reader) {
    return Promise.resolve(err({ mediaType, type: "unsupported" as const }));
  }
  switch (reader.kind) {
    case "pdf":
      return parsePdf(bytes);
    case "docx":
      return parseDocx(bytes);
    case "prose": {
      const text = decodeUtf8(bytes);
      return Promise.resolve(
        text === null
          ? notUtf8()
          : ok({ format: "text" as const, pages: [{ page: null, text }] })
      );
    }
    case "code": {
      const text = decodeUtf8(bytes);
      if (text === null) {
        return Promise.resolve(notUtf8());
      }
      // A fence the file itself contains can't close ours early.
      const fence = text.includes("```") ? "~~~~" : "```";
      return Promise.resolve(
        ok({
          format: "code" as const,
          pages: [
            {
              page: null,
              text: `${fence}${reader.language}\n${text.trimEnd()}\n${fence}`,
            },
          ],
        })
      );
    }
    default:
      return reader satisfies never;
  }
};

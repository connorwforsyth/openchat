import { z } from "zod";

// `chunkDocument` (PLAN.md §8 RAG step 3): a parsed document's text in,
// retrieval-sized chunks out. Pure. Chunks follow the document's structure:
// a heading starts a new chunk, paragraphs and code fences stay whole when
// they fit, and each chunk carries the headings it sits under, so a chunk
// from the middle of a section still says what it's about. Consecutive
// chunks within a section overlap a little, so a sentence cut at a boundary
// is still found whole on one side of it.
//
// Sizes are in estimated tokens, not a real tokenizer: embedding models
// each tokenize differently, the limits we care about are soft, and a
// tokenizer per model would be a heavy dependency for a few percent.

export const chunkOptionsSchema = z
  .object({
    /** Soft ceiling per chunk, headings included. */
    maxTokens: z.int().min(32).max(8192).default(400),
    /** How much of a chunk's end the next chunk in the same section repeats. */
    overlapTokens: z.int().min(0).default(48),
  })
  .refine((options) => options.overlapTokens * 2 <= options.maxTokens, {
    message: "`overlapTokens` must be at most half of `maxTokens`",
    path: ["overlapTokens"],
  });
export type ChunkOptions = z.input<typeof chunkOptionsSchema>;

/** One page of a paged document (PDF), or the whole text (`page: null`). */
export const documentPageSchema = z.object({
  page: z.int().min(1).nullable(),
  text: z.string(),
});
export type DocumentPage = z.infer<typeof documentPageSchema>;

export const documentChunkSchema = z.object({
  /** The heading path the chunk sits under, outermost first. */
  headings: z.array(z.string()),
  page: z.int().min(1).nullable(),
  /** What gets embedded and shown as the snippet: the heading path, then the content. */
  text: z.string().min(1),
  tokenCount: z.int().min(1),
});
export type DocumentChunk = z.infer<typeof documentChunkSchema>;

// CJK scripts run about a token per character; everything else about four
// characters per token. Close enough to keep chunks inside model limits.
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export const estimateTokens = (text: string): number => {
  const wide = text.match(WIDE)?.length ?? 0;
  const narrow = text.length - wide;
  return text.trim() === "" ? 0 : Math.max(1, wide + Math.ceil(narrow / 4));
};

type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "code" | "paragraph"; readonly text: string };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Markdown-ish blocks: headings, fenced code, and blank-line separated paragraphs. */
const toBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let fence: { marker: string; lines: string[] } | null = null;

  const endParagraph = () => {
    const joined = paragraph.join("\n").trim();
    if (joined) {
      blocks.push({ kind: "paragraph", text: joined });
    }
    paragraph = [];
  };

  for (const line of text.replaceAll(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      fence.lines.push(line);
      if (line.trim().startsWith(fence.marker) && fence.lines.length > 1) {
        blocks.push({ kind: "code", text: fence.lines.join("\n") });
        fence = null;
      }
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening?.[1]) {
      endParagraph();
      fence = { lines: [line], marker: opening[1] };
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1] && heading[2]) {
      endParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      continue;
    }
    if (line.trim() === "") {
      endParagraph();
    } else {
      paragraph.push(line.trimEnd());
    }
  }
  if (fence) {
    // An unclosed fence is still content.
    blocks.push({ kind: "code", text: fence.lines.join("\n") });
  }
  endParagraph();
  return blocks;
};

const SENTENCE_END = /(?<=[.!?。！？])\s+/u;
const NEWLINE = /\n/;
const WHITESPACE = /\s+/;

/** Cuts `text` into pieces of at most `budget` tokens, at the gentlest boundary that works. */
const split = (text: string, budget: number, code: boolean): string[] => {
  if (estimateTokens(text) <= budget) {
    return [text];
  }
  const separators = code ? [NEWLINE] : [NEWLINE, SENTENCE_END, WHITESPACE];
  for (const separator of separators) {
    const units = text.split(separator).filter((unit) => unit.trim() !== "");
    if (units.length > 1) {
      const joiner = separator === NEWLINE ? "\n" : " ";
      return pack(units, budget, joiner).flatMap((piece) =>
        split(piece, budget, code)
      );
    }
  }
  // One unbreakable run (a URL, base64): cut it by characters.
  const size = Math.max(1, budget * 4);
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    pieces.push(text.slice(start, start + size));
  }
  return pieces;
};

/** Greedily joins units into pieces of at most `budget` tokens. */
const pack = (
  units: readonly string[],
  budget: number,
  joiner: string
): string[] => {
  const pieces: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit;
    if (current && estimateTokens(candidate) > budget) {
      pieces.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
};

/** The last words of `text`, at most `budget` tokens. */
const tail = (text: string, budget: number): string => {
  if (budget <= 0) {
    return "";
  }
  const words = text.split(WHITESPACE).filter(Boolean);
  const kept: string[] = [];
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const next = [words[index], ...kept].join(" ");
    if (estimateTokens(next) > budget) {
      break;
    }
    kept.unshift(words[index] ?? "");
  }
  return kept.join(" ");
};

const breadcrumb = (headings: readonly string[]): string =>
  headings.join(" › ");

interface ChunkLimits {
  readonly maxTokens: number;
  readonly overlapTokens: number;
}

/**
 * Packs one page's pieces into chunks under the current heading path,
 * carrying the end of each chunk into the next while a section continues.
 */
const pageWriter = (
  page: number | null,
  headings: () => readonly string[],
  { maxTokens, overlapTokens }: ChunkLimits,
  emit: (chunk: DocumentChunk) => void
) => {
  let body: string[] = [];
  // What the previous chunk in this section ended with, to overlap.
  let carry = "";

  const budget = () =>
    Math.max(
      Math.floor(maxTokens / 2),
      maxTokens - estimateTokens(breadcrumb(headings())) - 1
    );
  const size = () => estimateTokens(body.join("\n\n"));
  // Only the overlap is in the body: nothing new would be lost by dropping it.
  const onlyCarry = () => body.length === 1 && body[0] === carry;

  const flush = (continues: boolean) => {
    const content = body.join("\n\n").trim();
    body = [];
    carry = "";
    if (!content) {
      return;
    }
    const trail = breadcrumb(headings());
    const text = trail ? `${trail}\n\n${content}` : content;
    emit({
      headings: [...headings()],
      page,
      text,
      tokenCount: estimateTokens(text),
    });
    carry = continues ? tail(content, overlapTokens) : "";
    if (carry) {
      body.push(carry);
    }
  };

  return {
    add: (piece: string) => {
      const pieceTokens = estimateTokens(piece);
      if (body.length > 0 && size() + pieceTokens + 1 > budget()) {
        flush(true);
        if (size() + pieceTokens + 1 > budget()) {
          // Only when estimates round badly: the piece wins over the overlap.
          body = [];
        }
      }
      body.push(piece);
    },
    /** Ends the section, at a heading or the end of the page. */
    close: () => {
      if (onlyCarry()) {
        body = [];
        carry = "";
      } else {
        flush(false);
      }
    },
    /** Pieces leave room for the overlap, so a chunk can always carry it. */
    pieceBudget: () => Math.max(8, budget() - overlapTokens - 2),
  };
};

/**
 * Splits a document into chunks. Pass a string for unpaged text, or pages
 * to keep page numbers for citations (a chunk never spans two pages; the
 * heading path carries over).
 */
export const chunkDocument = (
  input: string | readonly DocumentPage[],
  options: ChunkOptions = {}
): DocumentChunk[] => {
  const limits = chunkOptionsSchema.parse(options);
  const pages: readonly DocumentPage[] =
    typeof input === "string" ? [{ page: null, text: input }] : input;

  const chunks: DocumentChunk[] = [];
  let headings: string[] = [];

  for (const { page, text } of pages) {
    const writer = pageWriter(
      page,
      () => headings,
      limits,
      (chunk) => chunks.push(chunk)
    );
    for (const block of toBlocks(text)) {
      if (block.kind === "heading") {
        writer.close();
        // Skipped levels (`#` then `###`) just nest one deeper.
        headings = [...headings.slice(0, block.level - 1), block.text];
        continue;
      }
      for (const piece of split(
        block.text,
        writer.pieceBudget(),
        block.kind === "code"
      )) {
        writer.add(piece);
      }
    }
    writer.close();
  }
  return chunks;
};

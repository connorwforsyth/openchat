// Splitting a streaming reply into speakable sentences (172). The voice loop
// speaks each sentence as soon as it's complete, so the first words play
// while the model is still writing the rest. Pure.

/** Shorter pieces wait to be joined with the next, so TTS isn't called per word. */
export const MIN_SENTENCE_CHARS = 24;
/** A run-on without punctuation is cut at a space past this. */
export const MAX_SENTENCE_CHARS = 280;

// A sentence ends at . ! ? … (or a CJK stop) followed by space, or at a
// newline. "e.g. " and "3.5" don't end one: the lookbehind wants a letter
// sequence of two or more before the dot, and a number isn't followed by a
// space.
const BOUNDARY = /(?<=[^\s.]{2,}[.!?…]["')\]]*|[。！？]|\n)\s+/g;

const ABBREVIATIONS = new Set([
  "dr.",
  "e.g.",
  "etc.",
  "i.e.",
  "mr.",
  "mrs.",
  "ms.",
  "no.",
  "st.",
  "vs.",
]);

const SPACES = /\s+/;

const endsWithAbbreviation = (piece: string) => {
  const last = piece.trim().split(SPACES).at(-1)?.toLowerCase() ?? "";
  return ABBREVIATIONS.has(last);
};

export interface SentenceSplit {
  /** What's left: an unfinished sentence, kept for the next delta. */
  readonly rest: string;
  readonly sentences: readonly string[];
}

/**
 * Takes complete sentences off the front of `buffer`. With `final`, the
 * remainder is a sentence too (the reply ended).
 */
export const takeSentences = (buffer: string, final = false): SentenceSplit => {
  const sentences: string[] = [];
  let start = 0;
  let pending = "";
  for (const match of buffer.matchAll(BOUNDARY)) {
    const end = match.index;
    const piece = pending + buffer.slice(start, end);
    start = end + match[0].length;
    if (
      endsWithAbbreviation(piece) ||
      piece.trim().length < MIN_SENTENCE_CHARS
    ) {
      pending = `${piece} `;
      continue;
    }
    sentences.push(piece.trim());
    pending = "";
  }
  let rest = pending + buffer.slice(start);
  while (rest.length > MAX_SENTENCE_CHARS) {
    const cut = rest.lastIndexOf(" ", MAX_SENTENCE_CHARS);
    const at = cut > 0 ? cut : MAX_SENTENCE_CHARS;
    sentences.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trimStart();
  }
  if (final) {
    const last = rest.trim();
    return { rest: "", sentences: last ? [...sentences, last] : sentences };
  }
  return { rest, sentences };
};

/**
 * Markdown as it should be said: no code blocks (they're read in the chat),
 * links by their text, no emphasis marks, headings and bullets as plain
 * lines. Pure; works on a partial reply, since an unclosed fence hides
 * everything after it until it closes.
 */
export const speakable = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/(\*\*|__|~~|\*|_)(?=\S)([^*_~\n]+?)\1/g, "$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

/**
 * The voice loop's view of a streaming reply: feed it the reply's whole
 * markdown so far, get back the sentences that just became complete. Pure;
 * the state is the number of speakable characters already handed out.
 */
export interface ReplyCursor {
  readonly buffer: string;
  readonly consumed: number;
}

export const EMPTY_CURSOR: ReplyCursor = { buffer: "", consumed: 0 };

const SETTLED = /[.!?…:;]\s|\n/g;

/**
 * The part of a streaming reply that won't change meaning as more arrives:
 * up to the last sentence end or newline, so a half-written `**bold` or
 * `[link` isn't cleaned (and counted) before it closes. Pure.
 */
export const settledPrefix = (markdown: string): string => {
  let end = 0;
  for (const match of markdown.matchAll(SETTLED)) {
    end = match.index + match[0].length;
  }
  return markdown.slice(0, end);
};

export const advanceReply = (
  cursor: ReplyCursor,
  markdown: string,
  final: boolean
): { readonly cursor: ReplyCursor; readonly sentences: readonly string[] } => {
  const text = speakable(final ? markdown : settledPrefix(markdown));
  // An unclosed code fence can make the speakable text shrink when it
  // closes; never re-speak, just hold.
  const fresh =
    text.length > cursor.consumed ? text.slice(cursor.consumed) : "";
  const split = takeSentences(cursor.buffer + fresh, final);
  return {
    cursor: {
      buffer: split.rest,
      consumed: Math.max(cursor.consumed, text.length),
    },
    sentences: split.sentences,
  };
};

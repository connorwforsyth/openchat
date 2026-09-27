// Ranking for the palette. Plain string scoring, no index: the palette ranks
// at most a few hundred cached items per keystroke, which takes well under a
// frame, and the server's full-text search covers everything else (D28).

const MARKS = /\p{M}/gu;
const WORD_BREAK = /[\s\-_/.:,()[\]]+/u;
const WHITESPACE = /\s+/u;

/** Case- and accent-insensitive, so "resume" finds "Résumé". */
export const foldText = (text: string): string =>
  text.normalize("NFKD").replace(MARKS, "").toLocaleLowerCase();

const isSubsequence = (needle: string, haystack: string): boolean => {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) {
      at += 1;
      if (at === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
};

/**
 * How well `text` answers `query`, from 0 (no match) to 1 (exact). Tiers:
 * exact, prefix, word prefix, substring, every word found, then in-order
 * letters (fuzzy, "nwcht" → "New chat") weighted by how tight the match is.
 */
export const scoreText = (query: string, text: string): number => {
  const q = foldText(query).trim();
  const t = foldText(text);
  if (q.length === 0 || t.length === 0) {
    return 0;
  }
  if (t === q) {
    return 1;
  }
  if (t.startsWith(q)) {
    return 0.9;
  }
  const words = t.split(WORD_BREAK).filter(Boolean);
  if (words.some((word) => word.startsWith(q))) {
    return 0.8;
  }
  if (t.includes(q)) {
    return 0.6;
  }
  const terms = q.split(WHITESPACE).filter(Boolean);
  if (
    terms.length > 1 &&
    terms.every((term) => words.some((word) => word.startsWith(term)))
  ) {
    return 0.5;
  }
  const compact = q.replace(WHITESPACE, "");
  if (isSubsequence(compact, t)) {
    return 0.1 + 0.2 * (compact.length / t.length);
  }
  return 0;
};

export interface Rankable {
  readonly keywords?: readonly string[];
  readonly subtitle?: string | null;
  readonly title: string;
}

/** The best of title, keywords (slightly less) and subtitle (less again). */
export const scoreEntry = (query: string, entry: Rankable): number =>
  Math.max(
    scoreText(query, entry.title),
    0.85 *
      Math.max(0, ...(entry.keywords ?? []).map((k) => scoreText(query, k))),
    entry.subtitle ? 0.7 * scoreText(query, entry.subtitle) : 0
  );

/**
 * Entries that match, best first; ties keep their given order (the caller's
 * order means something: recency for chats, importance for actions). An
 * empty query returns everything as given.
 */
export const rankEntries = <T extends Rankable>(
  query: string,
  entries: readonly T[],
  limit = Number.POSITIVE_INFINITY
): readonly T[] => {
  if (query.trim().length === 0) {
    return entries.slice(0, limit);
  }
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(query, entry) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
};

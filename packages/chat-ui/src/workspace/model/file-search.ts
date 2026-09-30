// File-name search in the Workspace panel (070), after Connor's Zettelkasten:
// typing filters the workspace's files by name and path, the results replace
// the tree, ↓/↑ walk them (wrapping) and Enter opens one. Names only: content
// search would need the sandbox, and a name is what people remember.

export interface FileMatch {
  /** The folder part, ending in `/`; empty at the root. */
  readonly directory: string;
  readonly name: string;
  readonly path: string;
}

const WHITESPACE = /\s+/;

/** The query's terms, lower-cased; an empty list means "not searching". */
export const searchTerms = (query: string): readonly string[] =>
  query.trim().toLowerCase().split(WHITESPACE).filter(Boolean);

const splitPath = (path: string): FileMatch => {
  const slash = path.lastIndexOf("/");
  return {
    directory: path.slice(0, slash + 1),
    name: path.slice(slash + 1),
    path,
  };
};

// Lower is better: a name that starts with the query, then a name that
// contains it, then a match somewhere in the path.
const rank = (match: FileMatch, query: string): number => {
  const name = match.name.toLowerCase();
  if (name.startsWith(query)) {
    return 0;
  }
  return name.includes(query) ? 1 : 2;
};

/**
 * The files whose path contains every term of `query`, best first: name
 * matches before path matches, then shallower and shorter paths, then A–Z.
 * Directories (paths ending in `/`) are never results; their files are.
 */
export const searchFiles = (
  paths: readonly string[],
  query: string
): readonly FileMatch[] => {
  const terms = searchTerms(query);
  if (terms.length === 0) {
    return [];
  }
  const whole = terms.join(" ");
  const matches = paths
    .filter((path) => !path.endsWith("/"))
    .filter((path) => {
      const lower = path.toLowerCase();
      return terms.every((term) => lower.includes(term));
    })
    .map(splitPath);
  return matches
    .map((match) => ({ match, rank: rank(match, whole) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.match.path.split("/").length - b.match.path.split("/").length ||
        a.match.path.length - b.match.path.length ||
        a.match.path.localeCompare(b.match.path)
    )
    .map(({ match }) => match);
};

/**
 * The result ↓ (`1`) or ↑ (`-1`) lands on, wrapping at either end. From no
 * active result (`-1`), ↓ goes to the first and ↑ to the last. `-1` when
 * there's nothing to move through.
 */
export const stepMatch = (
  active: number,
  count: number,
  delta: 1 | -1
): number => {
  if (count <= 0) {
    return -1;
  }
  if (active < 0 || active >= count) {
    return delta === 1 ? 0 : count - 1;
  }
  return (active + delta + count) % count;
};

/** What Enter opens: the active result, else the first one. */
export const committedMatch = (
  matches: readonly FileMatch[],
  active: number
): FileMatch | null => matches[active] ?? matches[0] ?? null;

// How a result reads (075). Eight files called "very-long-component-…" all
// ended in the same ellipsis, so a long name now gives way in the middle:
// the head truncates and the tail, where names differ (`number-7.tsx`,
// `Panel.test.tsx`), stays. The folder does the same under it, keeping its
// last folder. And what the query matched is marked in both.

/** A run of a result's text, `hit` where a search term matched it. */
export interface TextRun {
  readonly hit: boolean;
  readonly text: string;
}

/** Text that truncates in the middle: `head` gives way, `tail` stays. */
export interface MiddleText {
  readonly head: readonly TextRun[];
  readonly tail: readonly TextRun[];
}

export interface ResultLabel {
  /** Empty at the root. */
  readonly directory: MiddleText;
  readonly name: MiddleText;
}

/**
 * `text` in runs, marked where any of `terms` (lower-cased, as
 * `searchTerms` gives them) occurs, case-insensitively. Overlapping and
 * touching hits merge into one run.
 */
export const highlightRuns = (
  text: string,
  terms: readonly string[]
): readonly TextRun[] => {
  if (text === "") {
    return [];
  }
  const lower = text.toLowerCase();
  // A few characters change length when lower-cased ("İ"); the offsets
  // would drift, so such a name just isn't marked.
  if (lower.length !== text.length) {
    return [{ hit: false, text }];
  }
  const hits = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    let at = term ? lower.indexOf(term) : -1;
    while (at >= 0) {
      hits.fill(true, at, at + term.length);
      at = lower.indexOf(term, at + 1);
    }
  }
  const runs: TextRun[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || hits[index] !== hits[start]) {
      runs.push({ hit: hits[start] ?? false, text: text.slice(start, index) });
      start = index;
    }
  }
  return runs;
};

/** The runs covering `text.slice(from, to)`. */
export const sliceRuns = (
  runs: readonly TextRun[],
  from: number,
  to: number
): readonly TextRun[] => {
  const sliced: TextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const end = offset + run.text.length;
    const text = run.text.slice(
      Math.max(0, from - offset),
      Math.max(0, to - offset)
    );
    if (text) {
      sliced.push({ hit: run.hit, text });
    }
    offset = end;
  }
  return sliced;
};

/** At least this much of a name's stem stays in view, and at most this much. */
const TAIL_STEM = { max: 12, min: 6 } as const;
/** Longer than this after the last dot, it isn't an extension. */
const EXTENSION_MAX = 8;
const SEPARATOR = /[-_. ]/;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

// A word starts after a separator or where camelCase turns upper.
const startsWord = (name: string, index: number): boolean => {
  const before = name[index - 1];
  const at = name[index];
  if (index === 0 || before === undefined || at === undefined) {
    return true;
  }
  return SEPARATOR.test(before) || (LOWER.test(before) && UPPER.test(at));
};

/**
 * Where a file name's tail starts: the extension and the stem's last word
 * or two, the shortest run of whole words of at least 6 characters (12 at
 * most, else just the last 6). `very-long-component-file-name-number-7.tsx`
 * keeps `number-7.tsx`, so it reads `very-long-com…number-7.tsx`.
 */
export const nameTailStart = (name: string): number => {
  const dot = name.lastIndexOf(".");
  const stemEnd =
    dot > 0 && name.length - dot <= EXTENSION_MAX ? dot : name.length;
  const latest = stemEnd - TAIL_STEM.min;
  if (latest <= 0) {
    return 0;
  }
  for (
    let index = latest;
    index >= Math.max(0, stemEnd - TAIL_STEM.max);
    index -= 1
  ) {
    if (startsWord(name, index)) {
      return index;
    }
  }
  return latest;
};

/** Where a folder's tail starts: its last folder stays (`src/…/components/`). */
export const directoryTailStart = (directory: string): number =>
  directory.lastIndexOf("/", directory.length - 2) + 1;

/** A result's name and folder, split for middle truncation and marked. */
export const resultLabel = (
  match: FileMatch,
  terms: readonly string[]
): ResultLabel => {
  // Marked over the whole path, so a term across the last "/" still shows.
  const runs = highlightRuns(match.path, terms);
  const folder = match.directory.length;
  const tail = folder + nameTailStart(match.name);
  const folderTail = directoryTailStart(match.directory);
  return {
    directory: {
      head: sliceRuns(runs, 0, folderTail),
      tail: sliceRuns(runs, folderTail, folder),
    },
    name: {
      head: sliceRuns(runs, folder, tail),
      tail: sliceRuns(runs, tail, match.path.length),
    },
  };
};

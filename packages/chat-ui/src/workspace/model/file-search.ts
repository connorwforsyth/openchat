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

// `.env` as text: read values, and change some while keeping every comment,
// blank line and unrelated variable where the person (or `.env.example`)
// put it. Pure; `setup.ts` does the file I/O.

export type EnvValues = Readonly<Record<string, string>>;

/** `null` clears a variable to `NAME=`; the line stays, as in `.env.example`. */
export type EnvUpdates = Readonly<Record<string, string | null>>;

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const NEEDS_QUOTES = /[\s#"'\\$]/;
const INLINE_COMMENT = /\s#/;
const TRAILING_NEWLINES = /\n*$/;

/** The inside of a double-quoted value, with backslash escapes undone. */
const readDoubleQuoted = (value: string): string | undefined => {
  let inner = "";
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      index += 1;
      inner += value[index];
    } else if (char === '"') {
      return inner;
    } else {
      inner += char;
    }
  }
};

/** Compose-style value: quotes stripped, and ` #` starts a comment when unquoted. */
const readValue = (raw: string): string => {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const inner = readDoubleQuoted(value);
    if (inner !== undefined) {
      return inner;
    }
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    if (end > 0) {
      return value.slice(1, end);
    }
  }
  const comment = value.search(INLINE_COMMENT);
  return comment === -1 ? value : value.slice(0, comment).trimEnd();
};

/**
 * Plain when it can be, quoted when a character would be misread. Compose
 * expands `$` in plain and double-quoted values, so those get single quotes.
 */
export const formatValue = (value: string): string => {
  if (!NEEDS_QUOTES.test(value)) {
    return value;
  }
  if (value.includes("$") && !value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

/** Every assignment; a repeated name keeps its last value, as compose does. */
export const parseEnv = (text: string): EnvValues =>
  Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const match = line.match(ASSIGNMENT);
      return match?.[1] ? [[match[1], readValue(match[2] ?? "")]] : [];
    })
  );

export const APPENDED_HEADER = "# --- Set by `bun run setup` ---";

/**
 * Rewrites the lines of the variables in `updates` in place and appends the
 * ones the file doesn't have yet, under one header. A variable already at
 * the wanted value keeps its line byte for byte.
 */
export const updateEnv = (text: string, updates: EnvUpdates): string => {
  const pending = new Map(Object.entries(updates));
  const lines = text.split("\n").map((line) => {
    const match = line.match(ASSIGNMENT);
    const name = match?.[1];
    // Every line of a repeated name is rewritten, since the last one wins.
    if (!(name && Object.hasOwn(updates, name))) {
      return line;
    }
    pending.delete(name);
    const wanted = updates[name] ?? "";
    return readValue(match[2] ?? "") === wanted
      ? line
      : `${name}=${formatValue(wanted)}`;
  });
  const additions = [...pending]
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${name}=${formatValue(value ?? "")}`);
  if (additions.length === 0) {
    return lines.join("\n");
  }
  const body = lines.join("\n").replace(TRAILING_NEWLINES, "");
  const header = text.includes(APPENDED_HEADER) ? [] : ["", APPENDED_HEADER];
  return `${[body, ...header, ...additions].join("\n")}\n`;
};

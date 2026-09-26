// Guard: catalogs match the source (PLAN.md D12). After `lingui extract --clean`
// the committed catalogs must be unchanged (no new or removed keys) and every
// entry must have a translation. The extract step runs in cli.ts; these are
// the pure checks over its results.
import { isFixture, isGenerated } from "./lib/paths";
import type { SourceFile, Violation } from "./lib/violation";

const LINGUI_CONFIG =
  /(?:^|\/)(?:lingui\.config\.(?:[cm]?[jt]s|json)|\.linguirc)$/;
const CATALOG = /\.po$/;
const QUOTED = /^"(.*)"$/;
const MSGID = /^msgid\s+(".*")$/;
const MSGSTR = /^msgstr(?:\[\d+\])?\s+(".*")$/;
const OBSOLETE = /^#~\s+msgid\b/;

export const isLinguiConfig = (path: string): boolean =>
  LINGUI_CONFIG.test(path) && !isGenerated(path) && !isFixture(path);

export const isCatalog = (path: string): boolean =>
  CATALOG.test(path) && !isGenerated(path) && !isFixture(path);

export const findLinguiConfigs = (paths: readonly string[]): string[] =>
  paths.filter(isLinguiConfig);

interface Entry {
  readonly line: number;
  readonly msgid: string;
  readonly msgstrs: readonly string[];
}

const unquote = (value: string): string => QUOTED.exec(value)?.[1] ?? "";

/**
 * Just enough of the PO format for this check: `msgid`/`msgstr` (plural forms
 * included) with continuation lines. Comments and `msgctxt` are skipped.
 */
const parseEntries = (content: string): Entry[] => {
  const entries: Entry[] = [];
  let current: { line: number; msgid: string; msgstrs: string[] } | undefined;
  let target: "msgid" | "msgstr" | undefined;
  for (const [index, raw] of content.split("\n").entries()) {
    const line = raw.trim();
    const id = MSGID.exec(line);
    const str = MSGSTR.exec(line);
    if (id) {
      current = { line: index + 1, msgid: unquote(id[1] ?? ""), msgstrs: [] };
      entries.push(current);
      target = "msgid";
    } else if (str && current) {
      current.msgstrs.push(unquote(str[1] ?? ""));
      target = "msgstr";
    } else if (QUOTED.test(line) && current && target) {
      const text = unquote(line);
      if (target === "msgid") {
        current.msgid += text;
      } else {
        const last = current.msgstrs.length - 1;
        current.msgstrs[last] = `${current.msgstrs[last] ?? ""}${text}`;
      }
    } else {
      target = undefined;
    }
  }
  return entries;
};

/** Untranslated keys and obsolete (`#~`) keys that `--clean` should have dropped. */
export const checkCatalog = (file: SourceFile): Violation[] => {
  const missing = parseEntries(file.content)
    // The header entry has an empty msgid.
    .filter((entry) => entry.msgid !== "")
    .filter(
      (entry) =>
        entry.msgstrs.length === 0 || entry.msgstrs.some((s) => s === "")
    )
    .map((entry) => ({
      column: 1,
      line: entry.line,
      message: `missing translation for "${entry.msgid}"`,
      path: file.path,
    }));
  const unused = file.content.split("\n").flatMap((line, index) =>
    OBSOLETE.test(line.trim())
      ? [
          {
            column: 1,
            line: index + 1,
            message: "unused key: run `lingui extract --clean` and commit",
            path: file.path,
          },
        ]
      : []
  );
  return [...missing, ...unused].sort((a, b) => a.line - b.line);
};

export const checkCatalogs = (files: readonly SourceFile[]): Violation[] =>
  files.filter((file) => isCatalog(file.path)).flatMap(checkCatalog);

/**
 * Catalogs that `lingui extract --clean` changed: new keys were never
 * extracted, or removed keys were never cleaned. Input is the paths from
 * `git status --porcelain`.
 */
export const checkCatalogDrift = (
  changedPaths: readonly string[]
): Violation[] =>
  changedPaths.filter(isCatalog).map((path) => ({
    column: 1,
    line: 1,
    message:
      "catalog is out of date with the source: run `lingui extract --clean` and commit the result",
    path,
  }));

import { globSync, readFileSync, writeFileSync } from "node:fs";

import { iconNames } from "../src/names";

// Points lucide imports at the registry (D19). shadcn and AI Elements install
// components with `from "lucide-react"`; run `bun run icons:codemod` after
// every `shadcn add` so they draw from the configured set instead.
//
//   bun run icons:codemod                      # apps/** and packages/**
//   bun run icons:codemod "packages/ui/**/*.tsx"

const targets = {
  "lucide-react": {
    module: "@workspace/icons",
    types: { LucideIcon: "Icon", LucideProps: "IconProps" },
  },
  "lucide-react-native": {
    module: "@workspace/icons/native",
    types: { LucideIcon: "NativeIcon", LucideProps: "NativeIconProps" },
  },
} as const;

type LucideModule = keyof typeof targets;

export interface CodemodResult {
  changed: boolean;
  code: string;
  /** Imported names the registry doesn't map; add them to `names.ts`. */
  unknown: string[];
}

const namedImport =
  /import\s+(type\s+)?\{([^}]*)\}\s*from\s*(["'])(lucide-react(?:-native)?)\3/g;
const asKeyword = /\s+as\s+/;
const excludedDirs = /(^|\/)(node_modules|\.next|dist)\//;
const anySpecifier =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])(lucide-react(?:-native)?)\2/g;

function rewriteSpecifier(
  specifier: string,
  module: LucideModule,
  known: ReadonlySet<string>,
  unknown: string[]
): string {
  const typePrefix = specifier.startsWith("type ") ? "type " : "";
  const body = specifier.slice(typePrefix.length).trim();
  const [imported = "", local] = body.split(asKeyword);
  const localName = local ?? imported;
  const typeNames: Record<string, string> = targets[module].types;
  const mapped =
    typeNames[imported] ??
    (known.has(imported) ? imported : undefined) ??
    (known.has(`${imported}Icon`) ? `${imported}Icon` : undefined);
  if (!mapped) {
    unknown.push(imported);
    return specifier;
  }
  return mapped === localName
    ? `${typePrefix}${mapped}`
    : `${typePrefix}${mapped} as ${localName}`;
}

/**
 * Rewrites lucide imports to the registry. Names keep their lucide spelling;
 * unsuffixed ones (`ChevronRight`) become `ChevronRightIcon as ChevronRight`
 * so call sites are untouched. Pure: the CLI below does the file I/O.
 */
export function rewriteIconImports(
  source: string,
  known: ReadonlySet<string> = new Set(iconNames)
): CodemodResult {
  const unknown: string[] = [];
  const withNames = source.replace(
    namedImport,
    (
      _match,
      typeOnly: string | undefined,
      list: string,
      quote: string,
      module: LucideModule
    ) => {
      const multiline = list.includes("\n");
      const specifiers = list
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => rewriteSpecifier(part, module, known, unknown));
      const body = multiline
        ? `{\n${specifiers.map((part) => `  ${part},`).join("\n")}\n}`
        : `{ ${specifiers.join(", ")} }`;
      return `import ${typeOnly ?? ""}${body} from ${quote}${module}${quote}`;
    }
  );
  const code = withNames.replace(
    anySpecifier,
    (_match, lead: string, quote: string, module: LucideModule) =>
      `${lead}${quote}${targets[module].module}${quote}`
  );
  return { changed: code !== source, code, unknown };
}

const defaultGlobs = ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"];

// The registry itself is the one place allowed to import lucide.
function isExcluded(path: string): boolean {
  return excludedDirs.test(path) || path.startsWith("packages/icons/");
}

function main(globs: string[]): number {
  const files = [
    ...new Set(globs.flatMap((pattern) => globSync(pattern))),
  ].filter((path) => !isExcluded(path));
  let rewritten = 0;
  let missing = false;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const { changed, code, unknown } = rewriteIconImports(source);
    if (changed) {
      writeFileSync(file, code);
      rewritten += 1;
      console.log(`rewrote ${file}`);
    }
    if (unknown.length > 0) {
      missing = true;
      console.error(
        `${file}: not in the icon registry: ${unknown.join(", ")}. Add them to packages/icons/src/names.ts and sets/lucide*.ts.`
      );
    }
  }
  console.log(`icons:codemod: ${rewritten} of ${files.length} files rewritten`);
  return missing ? 1 : 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  process.exitCode = main(args.length > 0 ? args : defaultGlobs);
}

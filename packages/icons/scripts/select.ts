import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

import { DEFAULT_CONFIG_FILE } from "@workspace/config/load";

import { iconNames } from "../src/names";
import type { IconPlatform } from "../src/set-ids";
import { describeChoice, type IconChoice, resolveIconChoice } from "./config";
import {
  materialFile,
  materialPackage,
  materialSymbols,
  renderMaterialGlyphs,
  svgPathData,
} from "./material";
import {
  lucideBindings,
  type Result,
  renderSelection,
  resolveSelection,
} from "./registry";
import { availableNames, setFile, setSource, srcDir } from "./sets";

// Build-time set selection (D19): writes `src/selected.ts` and
// `src/selected.native.ts`, which re-export each name from exactly one set
// file, and `src/sets/material.glyphs.ts`, the Material path data in the
// configured variant. Bundlers only ever see the chosen set (plus lucide for
// its gaps), so the others are never in the bundle.
//
// The choice comes from `icons` in app.config.yaml, read where the web server
// reads it: `CONFIG_PATH`, else `app.config.yaml`, both relative to apps/web.
// `ICON_SET`, `ICON_STYLE`, `ICON_WEIGHT` and `ICON_FILL` override it; that's
// how a Docker image, built before its config is mounted, gets its set.

// bun's built-in YAML parser saves this package a dependency. bun's types
// aren't installed, so this declares just the part used here.
declare const Bun: {
  readonly YAML: { readonly parse: (text: string) => unknown };
};

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const appDir = join(repoRoot, "apps", "web");
const requireFrom = createRequire(import.meta.url);

interface ConfigBlock {
  /** The `icons` value, or undefined when there's no file or no block. */
  readonly block: unknown;
  readonly source: string | undefined;
}

function readConfigBlock(
  env: NodeJS.ProcessEnv
): Result<ConfigBlock, string[]> {
  const explicit = env.CONFIG_PATH?.trim();
  const path = resolve(appDir, explicit || DEFAULT_CONFIG_FILE);
  if (!existsSync(path)) {
    // Unlike at boot, a missing CONFIG_PATH isn't fatal here: a deployment
    // may set it for the runtime mount, which a build never sees.
    if (explicit) {
      console.warn(
        `icons:select: CONFIG_PATH is ${path}, which doesn't exist at build time; using ICON_* and defaults.`
      );
    }
    return { ok: true, value: { block: undefined, source: undefined } };
  }
  const inRepo = relative(repoRoot, path);
  const source = inRepo.startsWith("..") ? path : inRepo;
  try {
    const document = Bun.YAML.parse(readFileSync(path, "utf8"));
    const block =
      typeof document === "object" && document !== null
        ? (document as Record<string, unknown>).icons
        : undefined;
    return { ok: true, value: { block, source } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { error: [`${source}: YAML: ${message}`], ok: false };
  }
}

function materialGlyphs(
  variant: IconChoice
): Result<[symbol: string, path: string][], string[]> {
  const packageDir = dirname(
    requireFrom.resolve(`${materialPackage(variant.weight)}/package.json`)
  );
  const symbols = materialSymbols(
    readFileSync(join(srcDir, "sets", "material.ts"), "utf8")
  );
  const glyphs = symbols.map((symbol) => {
    const file = join(packageDir, materialFile(variant, symbol));
    const path = existsSync(file)
      ? svgPathData(readFileSync(file, "utf8"))
      : undefined;
    return [symbol, path, file] as const;
  });
  const broken = glyphs.filter(([, path]) => path === undefined);
  if (broken.length > 0) {
    return {
      error: broken.map(
        ([symbol, , file]) =>
          `material: no single-path SVG for "${symbol}" at ${file}`
      ),
      ok: false,
    };
  }
  return {
    ok: true,
    value: glyphs.map(([symbol, path]) => [symbol, path ?? ""]),
  };
}

// Leave an unchanged file alone so watchers don't rebuild for nothing.
function writeIfChanged(target: string, source: string): void {
  if (!existsSync(target) || readFileSync(target, "utf8") !== source) {
    writeFileSync(target, source);
  }
}

function fail(problems: readonly string[]): never {
  for (const problem of problems) {
    console.error(`icons:select: ${problem}`);
  }
  process.exit(1);
}

const config = readConfigBlock(process.env);
if (!config.ok) {
  fail(config.error);
}
const resolved = resolveIconChoice(config.value.block, process.env);
if (!resolved.ok) {
  fail(resolved.error);
}
const choice = resolved.value;

// Written whichever set is chosen, so `sets/material.ts` always type-checks.
const glyphs = materialGlyphs(choice);
if (!glyphs.ok) {
  fail(glyphs.error);
}
writeIfChanged(
  join(srcDir, "sets", "material.glyphs.ts"),
  renderMaterialGlyphs(choice, glyphs.value)
);

const outputs: Record<IconPlatform, string> = {
  native: "selected.native.ts",
  web: "selected.ts",
};

const from = config.value.source ? ` (${config.value.source})` : "";
for (const platform of ["web", "native"] as const) {
  const file = setFile(choice.set, platform);
  const selection = resolveSelection(
    iconNames,
    availableNames(file) ?? new Set()
  );
  const lucideSource = setSource(setFile("lucide", platform));
  const lucide = lucideSource ? lucideBindings(lucideSource) : undefined;
  writeIfChanged(
    join(srcDir, outputs[platform]),
    renderSelection({
      lucide,
      platform,
      selection,
      setFile: file,
      setId: choice.set,
    })
  );
  const drawn = file ? selection.fromSet.length : 0;
  console.log(
    `icons (${platform}): ${describeChoice(choice)}${from}, ${drawn}/${iconNames.length} from the set`
  );
}

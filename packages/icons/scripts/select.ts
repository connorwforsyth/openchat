import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { DEFAULT_CONFIG_FILE } from "@workspace/config/load";

import { iconNames } from "../src/names";
import type { IconPlatform } from "../src/set-ids";
import {
  describeChoice,
  type IconChoice,
  iconEnvWarning,
  resolveIconChoice,
} from "./config";
import {
  materialSymbols,
  pickGlyphs,
  renderMaterialGlyphs,
  type VendoredWeight,
  vendoredFile,
  vendoredWeightSchema,
} from "./material";
import {
  lucideBindings,
  type Result,
  renderSelection,
  resolveSelection,
} from "./registry";
import {
  availableNames,
  materialVendorDir,
  setFile,
  setSource,
  srcDir,
} from "./sets";

// Build-time set selection (D19): writes `src/selected.ts` and
// `src/selected.native.ts`, which re-export each name from exactly one set
// file, and `src/sets/material.glyphs.ts`, the Material path data in the
// configured variant, picked from vendor/material-symbols. Bundlers only ever
// see the chosen set (plus lucide for its gaps), so the others are never in
// the bundle.
//
// The choice comes from `icons` in app.config.yaml, read where the web server
// reads it: `CONFIG_PATH`, else `app.config.yaml`, both relative to apps/web.
// The block decides (130). `ICON_SET`, `ICON_STYLE`, `ICON_WEIGHT` and
// `ICON_FILL` count only when there's no block: Docker build args for an
// image built without a config. Either way, setting them gets a warning.

// bun's built-in YAML parser saves this package a dependency. bun's types
// aren't installed, so this declares just the part used here.
declare const Bun: {
  readonly YAML: { readonly parse: (text: string) => unknown };
};

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const appDir = join(repoRoot, "apps", "web");

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
        `icons:select: CONFIG_PATH is ${path}, which doesn't exist at build time; using the defaults (or ICON_* build args).`
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

interface MaterialGlyphs {
  readonly glyphs: [symbol: string, path: string][];
  readonly source: VendoredWeight;
}

// From the committed subset in vendor/material-symbols, not the packages, so
// installs don't carry ~165k SVG files for a hundred symbols.
function materialGlyphs(variant: IconChoice): Result<MaterialGlyphs, string[]> {
  const file = join(materialVendorDir, vendoredFile(variant.weight));
  if (!existsSync(file)) {
    return {
      error: [`material: ${file} is missing; run \`bun run icons:vendor\``],
      ok: false,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { error: [`material: ${file}: ${message}`], ok: false };
  }
  const parsed = vendoredWeightSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map(
        (issue) =>
          `material: ${file}: ${issue.path.join(".")}: ${issue.message}`
      ),
      ok: false,
    };
  }
  const symbols = materialSymbols(
    readFileSync(join(srcDir, "sets", "material.ts"), "utf8")
  );
  const glyphs = pickGlyphs(parsed.data, variant, symbols);
  return glyphs.ok
    ? { ok: true, value: { glyphs: glyphs.value, source: parsed.data } }
    : glyphs;
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
const warning = iconEnvWarning(
  config.value.block,
  process.env,
  config.value.source
);
if (warning) {
  console.warn(`icons:select: warning: ${warning}`);
}

// Written whichever set is chosen, so `sets/material.ts` always type-checks.
const glyphs = materialGlyphs(choice);
if (!glyphs.ok) {
  fail(glyphs.error);
}
writeIfChanged(
  join(srcDir, "sets", "material.glyphs.ts"),
  renderMaterialGlyphs(choice, glyphs.value.source, glyphs.value.glyphs)
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

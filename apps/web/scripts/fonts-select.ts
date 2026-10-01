import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { DEFAULT_CONFIG_FILE } from "@workspace/config/load";
import { fontsSchema } from "@workspace/config/schema";

import { monoFonts, renderSelectedFonts, sansFonts } from "../lib/font-catalog";

// Build-time font selection: writes `lib/fonts.selected.ts` with a
// `localFont` call for just the fonts `fonts:` in app.config.yaml names, so
// the others never reach the build. The file is read where the web server
// reads it: `CONFIG_PATH`, else `app.config.yaml`, both relative to apps/web.
// No file, or no `fonts` block, means the defaults (Geist).

// bun's built-in YAML parser saves a dependency. bun's types aren't
// installed, so this declares just the part used here.
declare const Bun: {
  readonly YAML: { readonly parse: (text: string) => unknown };
};

const appDir = join(import.meta.dirname, "..");
const out = join(appDir, "lib", "fonts.selected.ts");

const readBlock = (): { block: unknown; source: string } => {
  const path = resolve(
    appDir,
    process.env.CONFIG_PATH?.trim() || DEFAULT_CONFIG_FILE
  );
  if (!existsSync(path)) {
    return { block: undefined, source: "defaults" };
  }
  const document = Bun.YAML.parse(readFileSync(path, "utf8"));
  const block =
    typeof document === "object" && document !== null
      ? (document as Record<string, unknown>).fonts
      : undefined;
  return { block, source: relative(appDir, path) };
};

const { block, source } = readBlock();
const parsed = fontsSchema.safeParse(block);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(
      `fonts:select: ${source}: fonts.${issue.path.join(".")}: ${issue.message}`
    );
  }
  process.exit(1);
}

// A missing file would only surface as a build error deep in next/font.
for (const font of [sansFonts[parsed.data.sans], monoFonts[parsed.data.mono]]) {
  if (!existsSync(join(appDir, "lib", font.src))) {
    console.error(`fonts:select: ${font.src} is missing; run \`bun install\``);
    process.exit(1);
  }
}

const next = renderSelectedFonts(parsed.data);
if (!existsSync(out) || readFileSync(out, "utf8") !== next) {
  writeFileSync(out, next);
}
console.log(`fonts: ${parsed.data.sans}, ${parsed.data.mono} (${source})`);

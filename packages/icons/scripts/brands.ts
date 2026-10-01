import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { brandMarkNames } from "../src/brands/brands";
import {
  generatedModule,
  type Mark,
  parseMarkSvg,
} from "../src/brands/codegen";

// Writes `src/brands/marks.generated.ts` from the installed
// @lobehub/icons-static-svg, copying only the marks `brands.ts` names. Run it
// through `bun run icons:generate`. Biome skips `*.generated.*`. Nothing
// reads the package at runtime: it's a devDependency, for this script and
// the test that checks the copy is current.

const require = createRequire(import.meta.url);

export const lobeIconsDir = (): string =>
  dirname(require.resolve("@lobehub/icons-static-svg/package.json"));

export const generatedPath = fileURLToPath(
  new URL("../src/brands/marks.generated.ts", import.meta.url)
);

/** The installed package's version and every listed mark, or the first failure. */
export const readMarks = async (): Promise<{
  readonly marks: Readonly<Record<string, Mark>>;
  readonly version: string;
}> => {
  const dir = lobeIconsDir();
  const { version } = JSON.parse(
    await readFile(join(dir, "package.json"), "utf8")
  ) as { version: string };
  const entries = await Promise.all(
    brandMarkNames().map(async (name) => {
      const svg = await readFile(join(dir, "icons", `${name}.svg`), "utf8");
      const parsed = parseMarkSvg(svg);
      if (!parsed.ok) {
        throw new Error(`icons/${name}.svg: ${parsed.error}`);
      }
      return [name, parsed.mark] as const;
    })
  );
  return { marks: Object.fromEntries(entries), version };
};

if (import.meta.main) {
  const { marks, version } = await readMarks();
  await writeFile(generatedPath, generatedModule(version, marks));
  process.stdout.write(
    `brands: ${Object.keys(marks).length} marks from @lobehub/icons-static-svg ${version}\n`
  );
}

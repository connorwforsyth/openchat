import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { bundlePrompts, generatedModule } from "../src/prompts/codegen";

// Writes `src/prompts/generated.ts` from the Markdown beside it. Run it
// through `bun run prompts:generate`, which formats the result too.

const root = fileURLToPath(new URL("../src/prompts", import.meta.url));

/** Every `.md` under `src/prompts`, by path relative to it. */
export const readPromptFiles = async (): Promise<Record<string, string>> => {
  const entries = await readdir(root, { recursive: true });
  const sources = entries
    .map((entry) => relative(root, join(root, entry)).replaceAll("\\", "/"))
    .filter((source) => source.endsWith(".md"));
  const contents = await Promise.all(
    sources.map((source) => readFile(join(root, source), "utf8"))
  );
  return Object.fromEntries(
    sources.map((source, index) => [source, contents[index] ?? ""])
  );
};

if (import.meta.main) {
  const bundle = bundlePrompts(await readPromptFiles());
  await writeFile(join(root, "generated.ts"), generatedModule(bundle));
  process.stdout.write(
    `prompts: ${bundle.base.length} base files, ${Object.keys(bundle.fragments).length} fragments\n`
  );
}

import { describe, expect, it } from "vitest";

import { readPromptFiles } from "../../scripts/generate-prompts";
import { bundlePrompts } from "./codegen";
import { BASE, FRAGMENTS } from "./generated";

// `generated.ts` is checked in, so it can go stale. This is the check that
// it still says what the Markdown says.

describe("generated.ts", () => {
  it("matches the Markdown (run `bun run prompts:generate` in packages/ai if not)", async () => {
    const bundle = bundlePrompts(await readPromptFiles());
    expect({ base: BASE, fragments: FRAGMENTS }).toEqual(bundle);
  });

  it("has the five base layers in order and the five fragments", () => {
    expect(BASE.map(({ source }) => source)).toEqual([
      "base/10-identity.md",
      "base/20-safety.md",
      "base/30-tool-etiquette.md",
      "base/40-workspace.md",
      "base/50-formatting.md",
    ]);
    expect(Object.keys(FRAGMENTS).sort()).toEqual([
      "artifacts",
      "memory",
      "mentions",
      "plan",
      "skills",
      "workspace",
    ]);
  });
});

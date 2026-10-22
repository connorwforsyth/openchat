import { describe, expect, it } from "vitest";

import { readArtifactDesign } from "./design-notes";

describe("readArtifactDesign", () => {
  it("puts the shared notes first, then each kind's own", async () => {
    const files: Record<string, string> = {
      "/brand/DESIGN.md": "Plain words. No exclamation marks.\n",
      "/brand/kinds/presentation/DESIGN.md": "One idea a slide.",
    };
    const read = (path: string) => Promise.resolve(files[path] ?? null);
    expect(await readArtifactDesign("/brand", read)).toEqual({
      presentation: "Plain words. No exclamation marks.\n\nOne idea a slide.",
      site: "Plain words. No exclamation marks.",
    });
    expect(await readArtifactDesign("/none", read)).toEqual({});
  });
});

import { MAX_DESIGN } from "@workspace/artifacts-kit/kind-theme";
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

  it("keeps room for a kind's own notes when the shared ones are long", async () => {
    const files: Record<string, string> = {
      "/brand/DESIGN.md": "x".repeat(MAX_DESIGN),
      "/brand/kinds/site/DESIGN.md": "Sites: one column.",
    };
    const read = (path: string) => Promise.resolve(files[path] ?? null);
    const notes = await readArtifactDesign("/brand", read);
    expect(notes.site?.length).toBe(MAX_DESIGN);
    expect(notes.site?.endsWith("Sites: one column.")).toBe(true);
    expect(notes.presentation?.length).toBe(MAX_DESIGN);
  });
  it("preserves a full cap of kind notes without shared notes", async () => {
    const own = "y".repeat(MAX_DESIGN + 100);
    const read = (path: string) =>
      Promise.resolve(path.endsWith("/site/DESIGN.md") ? own : null);
    expect((await readArtifactDesign("/brand", read)).site).toBe(
      own.slice(0, MAX_DESIGN)
    );
  });
});

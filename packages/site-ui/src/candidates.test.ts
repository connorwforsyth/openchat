import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";

import {
  candidatesOf,
  kitSources,
  ownSources,
  renderCandidates,
} from "../scripts/candidates-core";
import {
  SITE_UI_CANDIDATE_SOURCES,
  SITE_UI_CANDIDATES,
} from "./candidates.generated";

// The Tailwind candidates are generated from the blocks' source and the kit
// files they import (`bun run candidates`); a class added to a block without
// regenerating would be missing from every site. The files are read through
// Vitest's server, since this runs in the browser.

// Paths are from packages/, and read from the package root.
const read = (path: string) => commands.readFile(`../${path}`);

describe("site-ui's Tailwind candidates", () => {
  it("are generated from the current source", async () => {
    const own = SITE_UI_CANDIDATE_SOURCES.filter((path) =>
      path.startsWith("site-ui/")
    );
    const ownTexts = await Promise.all(own.map(read));
    const kit = kitSources(ownTexts);
    expect([...own, ...kit]).toEqual(SITE_UI_CANDIDATE_SOURCES);
    const texts = [...ownTexts, ...(await Promise.all(kit.map(read)))];
    expect(
      renderCandidates(SITE_UI_CANDIDATE_SOURCES, candidatesOf(texts))
    ).toBe(await read("site-ui/src/candidates.generated.ts"));
  });

  it("cover every block file, and the classes the blocks use", () => {
    expect(
      ownSources([
        "blocks.tsx",
        "blocks.test.tsx",
        "candidates.generated.ts",
        "index.ts",
      ])
    ).toEqual(["blocks.tsx", "index.ts"]);
    expect(SITE_UI_CANDIDATES).toEqual(
      expect.arrayContaining([
        "bg-background",
        "text-muted-foreground",
        "ms-auto",
        "rounded-xl",
        "bg-primary",
      ])
    );
  });
});

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { readDesignFiles, renderGenerated } from "./generate";

describe("the design guides", () => {
  it("are generated from their design.md files", async () => {
    const generated = await readFile(
      new URL("generated.ts", import.meta.url),
      "utf8"
    );
    expect(generated).toBe(renderGenerated(await readDesignFiles()));
  });
});

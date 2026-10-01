import { describe, expect, it } from "vitest";

import { monoFonts, renderSelectedFonts, sansFonts } from "./font-catalog";

describe("font catalog", () => {
  it("compiles in only the chosen pair", () => {
    const file = renderSelectedFonts({ mono: "jetbrains-mono", sans: "inter" });
    expect(file).toContain(sansFonts.inter.src);
    expect(file).toContain(monoFonts["jetbrains-mono"].src);
    expect(file).not.toContain("Geist");
    expect(file).not.toContain("open-sans");
  });
});

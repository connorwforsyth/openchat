import { describe, expect, it } from "vitest";

import { displayKind, isDisplayedKind, kindsShownAs } from "./display";

describe("the kinds people see", () => {
  it("show Mermaid as a Diagram, and every other kind as itself", () => {
    expect(displayKind("mermaid")).toBe("diagram");
    expect(displayKind("diagram")).toBe("diagram");
    expect(displayKind("site")).toBe("site");
    expect(isDisplayedKind("mermaid")).toBe(false);
    expect(isDisplayedKind("diagram")).toBe(true);
  });

  it("filter by Diagram to both formats", () => {
    expect(kindsShownAs("diagram")).toEqual(["diagram", "mermaid"]);
    expect(kindsShownAs("site")).toEqual(["site"]);
    // An old `?kind=mermaid` still finds the diagrams.
    expect(kindsShownAs("mermaid")).toEqual(["diagram", "mermaid"]);
  });
});

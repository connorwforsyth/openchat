import { describe, expect, it } from "vitest";

import { spriteSheet, svgToSymbol } from "./sprite";

describe("svgToSymbol", () => {
  it("moves the root's paint onto a group inside the symbol", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="lucide"><path d="m6 9 6 6 6-6"></path></svg>';
    expect(svgToSymbol(svg, "ws-chevron")).toEqual({
      ok: true,
      value:
        '<symbol id="ws-chevron" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"></path></g></symbol>',
    });
  });

  it("keeps a filled set's own viewBox", () => {
    const svg =
      '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M0 0h256"></path></svg>';
    expect(svgToSymbol(svg, "ws-file")).toEqual({
      ok: true,
      value:
        '<symbol id="ws-file" viewBox="0 0 256 256"><g fill="currentColor"><path d="M0 0h256"></path></g></symbol>',
    });
  });

  it("rejects markup that isn't one svg element", () => {
    expect(svgToSymbol("<span></span>", "x")).toEqual({
      error: { id: "x", kind: "not-svg" },
      ok: false,
    });
  });
});

describe("spriteSheet", () => {
  it("wraps symbols in a hidden sprite", () => {
    expect(spriteSheet(["<symbol></symbol>"])).toBe(
      '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol></symbol></svg>'
    );
  });
});

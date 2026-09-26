import { describe, expect, it } from "vitest";
import { loadFixture, locations } from "./lib/fixtures";
import { checkTokens, isTokenChecked, TOKEN_SOURCE } from "./tokens";

const file = (path: string, content: string) => [{ content, path }];

describe("tokens guard", () => {
  it("flags hex, colour functions, palette classes and palette variables", () => {
    const violations = checkTokens(loadFixture("tokens", "bad"));
    expect(locations(violations)).toEqual([
      "apps/web/app/page.tsx:3",
      "apps/web/app/page.tsx:3",
      "apps/web/app/page.tsx:3",
      "apps/web/app/page.tsx:4",
      "apps/web/app/page.tsx:5",
      "apps/web/app/page.tsx:6",
      "apps/web/app/page.tsx:6",
      "packages/ui/src/components/panel.css:2",
      "packages/ui/src/components/panel.css:3",
      "packages/ui/src/components/panel.css:4",
    ]);
    expect(violations[0]?.message).toContain('"bg-zinc-950"');
  });

  it("passes semantic tokens, the token source, comments, anchors and generated code", () => {
    expect(checkTokens(loadFixture("tokens", "good"))).toEqual([]);
  });

  it("reports editor-clickable columns", () => {
    const [violation] = checkTokens(
      file("apps/web/a.tsx", 'const a = 1;\nconst c = "#fff";')
    );
    expect(violation).toMatchObject({ column: 12, line: 2 });
  });

  it("only scans hand-written product source", () => {
    expect(isTokenChecked("apps/web/app/page.tsx")).toBe(true);
    expect(isTokenChecked("packages/ui/src/styles/other.css")).toBe(true);
    expect(isTokenChecked(TOKEN_SOURCE)).toBe(false);
    expect(isTokenChecked("apps/web/.next/static/chunk.js")).toBe(false);
    expect(isTokenChecked("packages/ui/node_modules/x/index.js")).toBe(false);
    expect(isTokenChecked("scripts/ci/tokens.ts")).toBe(false);
    expect(isTokenChecked("apps/web/README.md")).toBe(false);
  });

  it("does not mistake private fields or longer words for hex", () => {
    const source = "this.#cafe = 1;\nconst id = '#faded';";
    expect(checkTokens(file("packages/x/a.ts", source))).toEqual([]);
  });
});

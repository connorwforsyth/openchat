import { describe, expect, it } from "vitest";
import { BRAND, checkBrand, isBrandChecked } from "./brand";
import { loadFixture, locations } from "./lib/fixtures";

describe("brand guard", () => {
  it("flags the name outside the allowed places, in any case", () => {
    const violations = checkBrand(loadFixture("brand", "bad"));
    expect(locations(violations)).toEqual([
      "app.config.yaml:4",
      "apps/web/app/layout.tsx:1",
      "docker-compose.yml:5",
      "docs/intro.md:3",
      "package.json:3",
    ]);
    // Mixed case is caught too: the fixture's layout says it title-cased.
    expect(violations[1]?.message.toLowerCase()).toContain(`"${BRAND}"`);
  });

  it("allows the brand block, root package name, image names and planning docs", () => {
    expect(checkBrand(loadFixture("brand", "good"))).toEqual([]);
  });

  it("allows the name only on the root package.json name line", () => {
    const content = `{ "name": "x" }\n"description": "${BRAND}"`;
    expect(checkBrand([{ content, path: "package.json" }])).toHaveLength(1);
    expect(
      checkBrand([
        { content: `"name": "@${BRAND}/web"`, path: "apps/web/package.json" },
      ])
    ).toHaveLength(1);
  });

  it("skips planning docs, the lockfile, CI config and the guard fixtures", () => {
    expect(isBrandChecked("PLAN.md")).toBe(false);
    expect(isBrandChecked("bun.lock")).toBe(false);
    expect(isBrandChecked(".wayfinder/map.md")).toBe(false);
    expect(isBrandChecked(".github/workflows/ci.yml")).toBe(false);
    expect(
      isBrandChecked("scripts/ci/__fixtures__/brand/bad/docs/intro.md")
    ).toBe(false);
    expect(isBrandChecked("AGENTS.md")).toBe(true);
    expect(isBrandChecked("docs/PLAN.md")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_PATH,
  checkIconImports,
  isIconChecked,
  parseAllowlist,
} from "./icon-imports";
import { loadFixture, locations } from "./lib/fixtures";

describe("icon-imports guard", () => {
  it("flags static, re-exported, dynamic and required icon imports", () => {
    const violations = checkIconImports(loadFixture("icon-imports", "bad"));
    expect(locations(violations)).toEqual([
      "apps/web/app/page.tsx:1",
      "apps/web/app/page.tsx:2",
      "packages/ui/src/components/icons.ts:1",
      "packages/ui/src/components/icons.ts:2",
      "packages/ui/src/components/icons.ts:3",
    ]);
    expect(violations[0]?.message).toContain('"lucide-react"');
  });

  it("passes @workspace/icons consumers and the icons package itself", () => {
    expect(checkIconImports(loadFixture("icon-imports", "good"))).toEqual([]);
  });

  it("lets allowlisted files through until they're fixed", () => {
    const files = loadFixture("icon-imports", "bad");
    const allowlist = "# pending 006\napps/web/app/page.tsx\n";
    expect(locations(checkIconImports(files, allowlist))).toEqual([
      "packages/ui/src/components/icons.ts:1",
      "packages/ui/src/components/icons.ts:2",
      "packages/ui/src/components/icons.ts:3",
    ]);
  });

  it("fails on a stale allowlist entry so the list only shrinks", () => {
    const files = loadFixture("icon-imports", "good");
    const violations = checkIconImports(files, "\napps/web/app/page.tsx\n");
    expect(locations(violations)).toEqual([`${ALLOWLIST_PATH}:2`]);
  });

  it("parses the allowlist, ignoring comments and blank lines", () => {
    expect(parseAllowlist("# c\n\na.ts # why\n  b.tsx\n")).toEqual([
      { line: 3, path: "a.ts" },
      { line: 4, path: "b.tsx" },
    ]);
  });

  it("scans product code outside packages/icons only", () => {
    expect(isIconChecked("packages/ui/src/components/button.tsx")).toBe(true);
    expect(isIconChecked("packages/icons/src/lucide.ts")).toBe(false);
    expect(isIconChecked("packages/ui/src/styles/globals.css")).toBe(false);
    expect(isIconChecked("scripts/ci/cli.ts")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { loadFixture, locations } from "./lib/fixtures";
import { checkMotion, isMotionChecked } from "./motion";

const file = (path: string, content: string) => [{ content, path }];

describe("motion guard", () => {
  it("flags transition-all, layout transitions and height keyframes", () => {
    const violations = checkMotion(loadFixture("motion", "bad"));
    expect(locations(violations)).toEqual([
      "packages/ui/src/components/panel.css:2",
      "packages/ui/src/components/panel.css:5",
      "packages/ui/src/components/panel.tsx:1",
      "packages/ui/src/components/panel.tsx:2",
      "packages/ui/src/components/panel.tsx:3",
      "packages/ui/src/components/panel.tsx:3",
      "packages/ui/src/components/panel.tsx:4",
      "packages/ui/src/components/panel.tsx:5",
      "packages/ui/src/components/panel.tsx:6",
    ]);
    expect(violations[2]?.message).toContain('"transition-all"');
    expect(violations[3]?.message).toContain("transitions height");
  });

  it("passes transform, opacity and colour, comments, the marker and other paths", () => {
    expect(checkMotion(loadFixture("motion", "good"))).toEqual([]);
  });

  it("reports editor-clickable columns", () => {
    const [violation] = checkMotion(
      file(
        "packages/ui/src/a.tsx",
        'const a = 1;\nconst b = "p-2 transition-all";'
      )
    );
    expect(violation).toMatchObject({ column: 16, line: 2 });
  });

  it("only scans packages/ui source", () => {
    expect(isMotionChecked("packages/ui/src/components/tool.tsx")).toBe(true);
    expect(isMotionChecked("packages/ui/src/styles/globals.css")).toBe(true);
    expect(isMotionChecked("packages/ui/src/components/README.md")).toBe(false);
    expect(isMotionChecked("packages/chat-ui/src/shell/app-shell.tsx")).toBe(
      false
    );
    expect(isMotionChecked("packages/ui/node_modules/x/index.js")).toBe(false);
  });

  it("does not mistake longer utilities for transition-all", () => {
    expect(
      checkMotion(
        file("packages/ui/src/a.tsx", '"transition-allowed x-transition-all"')
      )
    ).toEqual([]);
  });
});

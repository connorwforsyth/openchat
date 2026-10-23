import { describe, expect, it } from "vitest";

import { readKindThemes, withKindThemes } from "./kind-themes";

const files: Record<string, string> = {
  "/brand/kinds/presentation/theme.css":
    ":root { --primary: blue; } .dark { --primary: navy; }",
  "/brand/theme.css": ":root { --primary: red; --card: white; }",
};
const read = (path: string) => Promise.resolve(files[path] ?? null);

describe("readKindThemes", () => {
  it("layers a kind's file over the shared one, each kind with its own variables", async () => {
    expect(await readKindThemes("/brand", read)).toEqual({
      presentation: {
        dark: { "--primary": "navy" },
        light: { "--primary": "blue" },
      },
      site: { dark: {}, light: { "--card": "white", "--primary": "red" } },
    });
  });

  it("has no themes without a brand folder", async () => {
    expect(await readKindThemes(null, read)).toEqual({});
  });
});

describe("withKindThemes", () => {
  it("puts the themes in the head as data nothing can break out of", () => {
    const html = withKindThemes("<html><head></head><body></body></html>", {
      presentation: { dark: {}, light: { "--primary": "red</script>" } },
    });
    expect(html).toContain('<script id="kind-themes" type="application/json">');
    expect(html).not.toContain("red</script>");
    expect(withKindThemes("<head></head>", {})).toBe("<head></head>");
  });
});

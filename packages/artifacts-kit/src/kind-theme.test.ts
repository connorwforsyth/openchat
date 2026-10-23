import { describe, expect, it } from "vitest";

import { layerThemes, parseKindTheme, themeDeclarations } from "./kind-theme";

describe("parseKindTheme", () => {
  it("takes the declared variables from :root and .dark, and nothing else", () => {
    const theme = parseKindTheme(
      `/* brand */
      :root { --primary: teal; --background: white; --made-up: 1px; color: red; }
      .dark { --primary: aqua; }
      body { --primary: green; }
      @media print { :root { --primary: black; } }`,
      "presentation"
    );
    expect(theme).toEqual({
      dark: { "--primary": "aqua" },
      light: { "--background": "white", "--primary": "teal" },
    });
  });

  it("refuses values that would load something or break out of the declaration", () => {
    expect(
      parseKindTheme(
        ':root { --background: url("https://x/y.png"); --primary: red</style>; --slide-font: "Inter", sans-serif; }',
        "presentation"
      ).light
    ).toEqual({ "--slide-font": '"Inter", sans-serif' });
  });

  it("refuses a value whose brackets or quotes don't close, so it can't swallow the rules after it", () => {
    expect(
      parseKindTheme(
        `:root { --primary: var(--x; --border: "a; --muted: image-set("x.png" 1x); --radius: calc(8px + 2px); --slide-font: "Inter", sans-serif; }`,
        "presentation"
      ).light
    ).toEqual({
      "--radius": "calc(8px + 2px)",
      "--slide-font": '"Inter", sans-serif',
    });
    expect(
      parseKindTheme(":root{--radius: calc(1px + 2px}", "presentation").light
    ).toEqual({});
  });

  it.each(["[red", "red]", "([)]", "red)", "'Inter"])(
    "refuses unbalanced delimiters in %s",
    (value) => {
      expect(
        parseKindTheme(`:root { --primary: ${value}; }`, "site").light
      ).toEqual({});
    }
  );

  it("lets each kind name its own variables", () => {
    const css = ":root { --card: white; --slide-font: Inter; }";
    expect(parseKindTheme(css, "site").light).toEqual({ "--card": "white" });
    expect(parseKindTheme(css, "presentation").light).toEqual({
      "--slide-font": "Inter",
    });
  });
});

describe("layerThemes and themeDeclarations", () => {
  it("puts a kind's file over the shared one, per mode", () => {
    const shared = parseKindTheme(
      ":root { --primary: red; --border: gray; } .dark { --primary: pink; }",
      "presentation"
    );
    const kind = parseKindTheme(":root { --primary: blue; }", "presentation");
    const layered = layerThemes(shared, kind);
    expect(themeDeclarations(layered, "light")).toBe(
      "--primary: blue; --border: gray;"
    );
    expect(themeDeclarations(layered, "dark")).toBe("--primary: pink;");
  });
});

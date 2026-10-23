import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  loadPresentation,
  loadSlide,
  nextPosition,
  notesOf,
  START,
} from "./presentation";
import { withBackground } from "./presentation-deck";
import { slideDeckCss } from "./slide-theme";

// Presentations in the runtime (164): each slide compiled like a React
// artifact against a table with slide-ui, stamped for Annotate, and the
// presenter's way through the steps.

const TITLE = `import { Title, Notes } from "@workspace/slide-ui";

export default function Intro() {
  return (
    <div className="wrap">
      <Title title="Q3 review" subtitle="Numbers" />
      <Notes>Breathe.</Notes>
    </div>
  );
}
`;

const deck = (
  slides: readonly { id: string; source: string; notes?: string }[]
) => JSON.stringify({ slides, title: "Deck" });

describe("loadSlide", () => {
  it("renders a slide-ui slide, stamping its own elements with the slide's file", () => {
    const element = loadSlide(TITLE, "intro");
    expect(element.ok).toBe(true);
    if (!element.ok) {
      return;
    }
    const html = renderToStaticMarkup(element.value);
    expect(html).toContain('data-src="slides/intro.tsx:5"');
    expect(html).toContain("Q3 review");
    expect(html).toContain("data-slide-canvas");
  });

  it("refuses what a slide may not import, even what a React artifact may", () => {
    expect(
      loadSlide(
        'import { createPortal } from "react-dom";\nexport default createPortal;',
        "x"
      )
    ).toEqual({ error: { kind: "import", message: "react-dom" }, ok: false });
  });
});

describe("loadPresentation", () => {
  it("loads each slide on its own, so a broken one doesn't take the deck", () => {
    const loaded = loadPresentation(
      deck([
        { id: "intro", notes: "Hello", source: TITLE },
        { id: "broken", source: "export default <div" },
      ])
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.title).toBe("Deck");
    expect(
      loaded.value.slides.map((slide) => [slide.id, slide.element.ok])
    ).toEqual([
      ["intro", true],
      ["broken", false],
    ]);
    expect(loaded.value.slides[0]?.notes).toBe("Hello");
  });

  it("says when the content isn't a deck", () => {
    expect(loadPresentation("not json")).toMatchObject({
      error: { kind: "syntax" },
      ok: false,
    });
  });
});

describe("nextPosition", () => {
  const steps = [0, 2, 1];

  it("reveals a slide's steps before moving on, and stops at the end", () => {
    const visited = [START];
    for (let index = 0; index < 6; index += 1) {
      visited.push(nextPosition(visited.at(-1) ?? START, "next", steps));
    }
    expect(visited).toEqual([
      { slide: 0, step: 0 },
      { slide: 1, step: 0 },
      { slide: 1, step: 1 },
      { slide: 1, step: 2 },
      { slide: 2, step: 0 },
      { slide: 2, step: 1 },
      { slide: 2, step: 1 },
    ]);
  });

  it("goes back a step, then to the previous slide with all its steps", () => {
    expect(nextPosition({ slide: 2, step: 1 }, "previous", steps)).toEqual({
      slide: 2,
      step: 0,
    });
    expect(nextPosition({ slide: 2, step: 0 }, "previous", steps)).toEqual({
      slide: 1,
      step: 2,
    });
    expect(nextPosition(START, "previous", steps)).toEqual(START);
  });

  it("jumps to either end, keeps its place on enter and exit, and survives no slides", () => {
    expect(nextPosition(START, "last", steps)).toEqual({ slide: 2, step: 1 });
    expect(nextPosition({ slide: 2, step: 1 }, "first", steps)).toEqual(START);
    expect(nextPosition({ slide: 1, step: 1 }, "enter", steps)).toEqual({
      slide: 1,
      step: 1,
    });
    expect(nextPosition({ slide: 9, step: 9 }, "exit", steps)).toEqual({
      slide: 2,
      step: 1,
    });
    expect(nextPosition({ slide: 3, step: 0 }, "next", [])).toEqual(START);
  });
});

describe("notesOf", () => {
  it("puts the deck's notes first, then the slide's own", () => {
    expect(notesOf(" Hello ", ["", "Breathe."])).toBe("Hello\n\nBreathe.");
    expect(notesOf("", [])).toBe("");
  });
});

describe("withBackground", () => {
  const fill = { a: 1, b: 1, g: 2, r: 3 };
  const full = {
    fill,
    h: 1080,
    line: null,
    radius: 0,
    type: "shape" as const,
    w: 1920,
    x: 0,
    y: 0,
  };

  it("makes a full-canvas box the slide's background", () => {
    expect(
      withBackground({
        background: null,
        items: [full],
        notes: "",
        picture: null,
      })
    ).toEqual({ background: fill, items: [], notes: "", picture: null });
    const smaller = { ...full, w: 800 };
    expect(
      withBackground({
        background: null,
        items: [smaller],
        notes: "",
        picture: null,
      }).items
    ).toEqual([smaller]);
  });
});

describe("slideDeckCss", () => {
  it("takes the theme's light or dark tokens out of globals.css", async () => {
    const globals = await readFile(
      new URL("../../../packages/ui/src/styles/globals.css", import.meta.url),
      "utf8"
    );
    const light = slideDeckCss(globals, "light");
    const dark = slideDeckCss(globals, "dark");
    expect(light).toContain("--background:");
    expect(dark).toContain("--background:");
    expect(light).not.toEqual(dark);
    expect(light).toContain("[data-step-hidden] { visibility: hidden; }");
    expect(light).not.toContain("transition");
  });

  it("puts the instance's deck theme after the app's, so it wins", async () => {
    const globals = await readFile(
      new URL("../../../packages/ui/src/styles/globals.css", import.meta.url),
      "utf8"
    );
    const css = slideDeckCss(globals, "light", "--primary: red;");
    expect(css.indexOf(":root {--primary: red;}")).toBeGreaterThan(
      css.indexOf("--background:")
    );
    expect(slideDeckCss(globals, "light")).not.toContain("--primary: red");
  });
});

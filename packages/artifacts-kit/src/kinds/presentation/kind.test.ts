import { describe, expect, it } from "vitest";

import { applyArtifactOperation, checkArtifact } from "../../define";
import { PRESENTATION_LIMITS, type Presentation } from "./content";
import { presentationKind } from "./kind";

const slide = (id: string, title = id) => ({
  id,
  source: `import { Title } from "@workspace/slide-ui";\nexport default function S() { return <Title title="${title}" />; }`,
});

const deck = (...ids: string[]): Presentation => ({
  slides: ids.map((id) => slide(id)),
  title: "Deck",
});

const text = (value: Presentation) => JSON.stringify(value);

const edit = (stored: Presentation | null, name: string, input: unknown) =>
  applyArtifactOperation(
    presentationKind,
    stored === null ? null : text(stored),
    name,
    input
  );

const idsAfter = (result: ReturnType<typeof edit>) =>
  result.ok
    ? (JSON.parse(result.value) as Presentation).slides.map((each) => each.id)
    : result.error;

describe("the Presentation kind", () => {
  it("is presented, annotated, exported to PowerPoint and PDF, and drawn by the runtime", () => {
    expect(presentationKind.capabilities).toEqual({
      aiCalls: false,
      annotate: true,
      present: true,
      share: false,
    });
    expect(presentationKind.render.runtime).toBe("presentation");
    expect(presentationKind.export.map((each) => each.extension)).toEqual([
      "json",
      "pptx",
      "pdf",
    ]);
    expect(presentationKind.starter).toEqual({ badge: "new" });
    expect(presentationKind.thumbnail).toBe("runtime");
    expect(presentationKind.instructions).toContain('type "presentation"');
    expect(presentationKind.instructions).toContain("1920×1080");
  });

  it("accepts a deck of slide-ui slides", () => {
    expect(checkArtifact(presentationKind, text(deck("intro", "end")))).toEqual(
      []
    );
  });

  it("says what's wrong with a deck that isn't one", () => {
    expect(checkArtifact(presentationKind, "slides")).toEqual([
      'content isn\'t JSON. A presentation is {"title": "…", "slides": [{"id": "intro", "source": "…"}]}',
    ]);
    expect(checkArtifact(presentationKind, text(deck()))).toEqual([
      "has no slides: a presentation needs at least one",
    ]);
    expect(checkArtifact(presentationKind, text(deck("a", "a")))).toEqual([
      'has more than one slide with id "a": give each slide its own id',
    ]);
    const many = deck(
      ...Array.from(
        { length: PRESENTATION_LIMITS.slides + 1 },
        (_, index) => `s${index}`
      )
    );
    expect(checkArtifact(presentationKind, text(many))).toEqual([
      `has ${PRESENTATION_LIMITS.slides + 1} slides; a presentation may have at most ${PRESENTATION_LIMITS.slides}`,
    ]);
    expect(
      checkArtifact(
        presentationKind,
        text({ slides: [{ id: "Intro!", source: "x" }], title: "" })
      )[0]
    ).toContain("isn't a slide id");
  });

  it("lets a slide import only React and slide-ui's components, and needs its default export", () => {
    const bad: Presentation = {
      slides: [
        {
          id: "chart",
          source: `import { LineChart } from "recharts";\nimport { Title, Hero } from "@workspace/slide-ui";\nfunction S() { return <Title title="x" />; }`,
        },
        {
          id: "all",
          source: `import * as ui from "@workspace/slide-ui";\nexport default () => <ui.Title title="x" />;`,
        },
      ],
      title: "Deck",
    };
    expect(checkArtifact(presentationKind, text(bad))).toEqual([
      'slide "chart" imports "recharts", which a slide can\'t use. A slide imports only "react" and "@workspace/slide-ui"; draw pictures with inline SVG or data: URLs',
      expect.stringContaining(
        'slide "chart": Hero isn\'t a slide-ui component'
      ),
      expect.stringContaining('slide "chart" has no default export'),
      expect.stringContaining(
        'slide "all" imports all of "@workspace/slide-ui"'
      ),
    ]);
  });
});

describe("the Presentation kind's edits", () => {
  it("add a slide at a position or at the end", () => {
    const added = edit(deck("a", "b"), "add_slide", {
      index: 1,
      notes: "hi",
      slide: "new",
      source: slide("new").source,
    });
    expect(idsAfter(added)).toEqual(["a", "new", "b"]);
    expect(
      idsAfter(
        edit(deck("a"), "add_slide", { slide: "z", source: slide("z").source })
      )
    ).toEqual(["a", "z"]);
  });

  it("refuse a repeated id or a position past the end", () => {
    expect(
      idsAfter(
        edit(deck("a"), "add_slide", {
          index: 5,
          slide: "a",
          source: "x",
        })
      )
    ).toEqual([
      `there's already a slide "a": give the new slide another id, or use update_slide`,
      "index 5 isn't a position in the deck: use 0 to 1, or leave it out to add at the end",
    ]);
  });

  it("update one slide's source or notes, and name the slides when the id is unknown", () => {
    const updated = edit(deck("a", "b"), "update_slide", {
      notes: "Say this",
      slide: "b",
    });
    expect(updated.ok && JSON.parse(updated.value).slides[1]).toEqual({
      ...slide("b"),
      notes: "Say this",
    });
    expect(
      idsAfter(edit(deck("a", "b"), "update_slide", { slide: "c" }))
    ).toEqual([
      `there's no slide "c". Its slides: "a", "b"`,
      "update_slide needs a source, notes, or both",
    ]);
  });

  it("move a slide, and refuse a bad position", () => {
    expect(
      idsAfter(
        edit(deck("a", "b", "c"), "move_slide", { index: 0, slide: "c" })
      )
    ).toEqual(["c", "a", "b"]);
    expect(
      idsAfter(
        edit(deck("a", "b", "c"), "move_slide", { index: 2, slide: "a" })
      )
    ).toEqual(["b", "c", "a"]);
    expect(
      idsAfter(edit(deck("a", "b"), "move_slide", { index: 2, slide: "a" }))
    ).toEqual(["index 2 isn't a position in the deck: use 0 to 1"]);
    expect(
      idsAfter(edit(deck("a"), "move_slide", { index: -1, slide: "a" }))
    ).toEqual(["index -1 isn't a position in the deck: use 0 to 0"]);
  });

  it("delete a slide, but not the last one", () => {
    expect(
      idsAfter(edit(deck("a", "b"), "delete_slide", { slide: "a" }))
    ).toEqual(["b"]);
    expect(idsAfter(edit(deck("a"), "delete_slide", { slide: "a" }))).toEqual([
      "that's the only slide, and a presentation needs one: replace it with update_slide instead",
    ]);
    expect(idsAfter(edit(deck("a"), "delete_slide", { slide: "x" }))).toEqual([
      `there's no slide "x". Its slides: "a"`,
    ]);
  });

  it("replace the whole deck", () => {
    expect(
      idsAfter(edit(deck("a"), "replace", { content: text(deck("x", "y")) }))
    ).toEqual(["x", "y"]);
  });
});

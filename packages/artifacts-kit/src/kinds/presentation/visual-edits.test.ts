import { describe, expect, it } from "vitest";
import { type Presentation, slideFileName } from "./content";
import {
  applyDeckVisualEdits,
  applyVisualEdits,
  type DeckVisualEdit,
  deckVisualEditSchema,
  stampSourceLocations,
  visualEditOpSchema,
} from "./visual-edits";

const INTRO = `import { Bullets, Slide, Title } from "@workspace/slide-ui";

export default function Intro() {
  return (
    <Slide>
      <Title title="Q3 review" />
      <h2 className="lede">Where we landed</h2>
      <Bullets items={["Revenue up", "Churn down", "Hiring paused"]} />
    </Slide>
  );
}
`;

const CLOSE = `import { Title } from "@workspace/slide-ui";

export default () => <Title title="Thanks" />;
`;

const DECK: Presentation = {
  slides: [
    { id: "intro", notes: "Open warm.", source: INTRO },
    { id: "close", source: CLOSE },
  ],
  title: "Q3",
};

/** The stamp on the first element whose stamped tag starts with `tag`. */
const stampOf = (stamped: string, tag: string) => {
  const marker = `<${tag} data-src="`;
  const at = stamped.indexOf(marker);
  const [stamp = ""] = stamped.slice(at + marker.length).split('"');
  const [file, line, column] = at < 0 ? [] : stamp.split(":");
  if (!(file && line && column)) {
    throw new Error(`no stamp on <${tag}>`);
  }
  return { column: Number(column), file, line: Number(line) };
};

const changedLines = (before: string, after: string) => {
  const was = before.split("\n");
  return after
    .split("\n")
    .flatMap((line, index) => (line === was[index] ? [] : [index + 1]));
};

describe("stampSourceLocations", () => {
  it("stamps hosts and components with file, line and column", () => {
    const stamped = stampSourceLocations(INTRO, slideFileName("intro"));
    expect(stampOf(stamped, "Slide")).toEqual({
      column: 4,
      file: "slides/intro.tsx",
      line: 5,
    });
    expect(stampOf(stamped, "h2")).toEqual({
      column: 6,
      file: "slides/intro.tsx",
      line: 7,
    });
  });

  it("returns source that doesn't parse unchanged", () => {
    expect(stampSourceLocations("export default <div", "x.tsx")).toBe(
      "export default <div"
    );
  });
});

describe("applyDeckVisualEdits", () => {
  it("round-trips a stamp into edits that change only the stamped elements", () => {
    const stamped = stampSourceLocations(INTRO, slideFileName("intro"));
    const at = (tag: string) => {
      const { line, column } = stampOf(stamped, tag);
      return { column, line, slide: "intro" };
    };
    const edits: DeckVisualEdit[] = [
      { ...at("h2"), ops: [{ kind: "set-text", value: "Where we are" }] },
      {
        ...at("h2"),
        ops: [{ key: "color", kind: "set-style", value: "tomato" }],
      },
      {
        ...at("Title"),
        ops: [{ kind: "set-prop", prop: "title", value: "Q3 in review" }],
      },
      {
        ...at("Bullets"),
        ops: [
          {
            kind: "set-prop",
            prevText: "Churn down",
            prop: "items.1",
            value: "Churn flat",
          },
        ],
      },
    ];
    const result = applyDeckVisualEdits(DECK, edits);
    if (!result.ok) {
      throw new Error(result.error.join("\n"));
    }
    const [intro, close] = result.value.slides;
    expect(close).toBe(DECK.slides[1]);
    expect(intro?.notes).toBe("Open warm.");
    expect(changedLines(INTRO, intro?.source ?? "")).toEqual([6, 7, 8]);
    expect(intro?.source).toContain('<Title title="Q3 in review" />');
    expect(intro?.source).toContain(
      `<h2 className="lede" style={{ color: 'tomato' }}>Where we are</h2>`
    );
    expect(intro?.source).toContain(
      `<Bullets items={["Revenue up", 'Churn flat', "Hiring paused"]} />`
    );
  });

  it("fails with every problem and leaves no partial deck", () => {
    const result = applyDeckVisualEdits(DECK, [
      { column: 0, line: 1, ops: [], slide: "missing" },
      {
        column: 6,
        line: 6,
        ops: [{ kind: "set-prop", prop: "items.0", value: "x" }],
        slide: "intro",
      },
      {
        column: 21,
        line: 3,
        ops: [{ kind: "set-prop", prop: "title", value: "Bye" }],
        slide: "close",
      },
      { column: 21, dependsOn: 1, line: 3, ops: [], slide: "close" },
    ]);
    expect(result).toEqual({
      error: [
        `edit 0: there's no slide "missing"`,
        'slide "intro", edit 1: prop "items" is missing, so it has no element 0',
        `slide "close", edit 3: depends on edit 1, which isn't an edit to this slide`,
      ],
      ok: false,
    });
  });

  it("maps dependsOn from deck indexes to the slide's own batch", () => {
    const result = applyDeckVisualEdits(DECK, [
      {
        column: 21,
        line: 3,
        ops: [{ kind: "set-text", value: "x" }],
        slide: "close",
      },
      {
        column: 6,
        line: 7,
        ops: [{ kind: "set-text", value: "Ahead" }],
        slide: "intro",
      },
      {
        column: 6,
        dependsOn: 1,
        line: 7,
        ops: [{ key: "color", kind: "set-style", value: "red" }],
        slide: "intro",
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual([
      'slide "close", edit 0: element has no editable text',
    ]);
  });
});

describe("applyVisualEdits", () => {
  it("reports each edit's outcome in order", () => {
    const { results, source } = applyVisualEdits(CLOSE, [
      {
        column: 21,
        line: 3,
        ops: [{ kind: "set-prop", prop: "title", value: "Bye" }],
      },
      { column: 0, line: 99, ops: [{ kind: "set-text", value: "x" }] },
    ]);
    expect(results).toEqual([
      { ok: true },
      { error: "no JSX element at location", ok: false },
    ]);
    expect(source).toContain('<Title title="Bye" />');
  });
});

describe("schemas", () => {
  it("refuses style keys that would be code and malformed props", () => {
    expect(
      visualEditOpSchema.safeParse({
        key: "color: 'red', ...x",
        kind: "set-style",
        value: "red",
      }).success
    ).toBe(false);
    expect(
      visualEditOpSchema.safeParse({
        kind: "set-prop",
        prop: "items.x",
        value: "a",
      }).success
    ).toBe(false);
    expect(
      deckVisualEditSchema.safeParse({
        column: 0,
        line: 0,
        ops: [],
        slide: "intro",
      }).success
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { Presentation } from "./content";
import { applyDeckAction, freeSlideId, NEW_SLIDE_SOURCE } from "./deck-actions";

const slide = (id: string, notes?: string) => ({
  id,
  ...(notes === undefined ? {} : { notes }),
  source: `export default () => <p>${id}</p>;`,
});

const deck: Presentation = {
  slides: [slide("intro", "Hello"), slide("plan"), slide("close")],
  title: "Q3",
};

const ids = (result: ReturnType<typeof applyDeckAction>) =>
  result.ok ? result.value.deck.slides.map((each) => each.id) : result.error;

describe("applyDeckAction", () => {
  it("adds a new slide after the selected one and selects it", () => {
    const result = applyDeckAction(deck, { after: "intro", type: "add" });
    expect(ids(result)).toEqual(["intro", "slide", "plan", "close"]);
    expect(result.ok && result.value.select).toBe("slide");
    expect(result.ok && result.value.deck.slides[1]?.source).toBe(
      NEW_SLIDE_SOURCE
    );
  });

  it("adds at the end when nothing is selected", () => {
    expect(ids(applyDeckAction(deck, { after: null, type: "add" }))).toEqual([
      "intro",
      "plan",
      "close",
      "slide",
    ]);
  });

  it("duplicates a slide with its notes right after it", () => {
    const result = applyDeckAction(deck, { slide: "intro", type: "duplicate" });
    expect(ids(result)).toEqual(["intro", "intro-copy", "plan", "close"]);
    expect(result.ok && result.value.deck.slides[1]).toEqual({
      ...slide("intro", "Hello"),
      id: "intro-copy",
    });
  });

  it("deletes a slide and selects its neighbour", () => {
    const result = applyDeckAction(deck, { slide: "close", type: "delete" });
    expect(ids(result)).toEqual(["intro", "plan"]);
    expect(result.ok && result.value.select).toBe("plan");
  });

  it("won't delete the only slide", () => {
    const one = { ...deck, slides: [slide("intro")] };
    expect(applyDeckAction(one, { slide: "intro", type: "delete" })).toEqual({
      error: expect.stringContaining("only slide"),
      ok: false,
    });
  });

  it("moves a slide to a position", () => {
    expect(
      ids(applyDeckAction(deck, { index: 0, slide: "close", type: "move" }))
    ).toEqual(["close", "intro", "plan"]);
  });

  it("rejects a move past the end", () => {
    expect(
      applyDeckAction(deck, { index: 3, slide: "intro", type: "move" }).ok
    ).toBe(false);
  });

  it("sets one slide's notes and leaves the rest", () => {
    const result = applyDeckAction(deck, {
      notes: "Say thanks",
      slide: "close",
      type: "notes",
    });
    expect(result.ok && result.value.deck.slides.map((s) => s.notes)).toEqual([
      "Hello",
      undefined,
      "Say thanks",
    ]);
  });
});

describe("freeSlideId", () => {
  it("numbers ids that are taken", () => {
    const taken = { ...deck, slides: [slide("slide"), slide("slide-2")] };
    expect(freeSlideId(taken, "slide")).toBe("slide-3");
  });

  it("keeps ids within the 40-character limit", () => {
    expect(freeSlideId(deck, `${"a".repeat(39)}-copy`).length).toBeLessThan(41);
  });
});

import { describe, expect, it } from "vitest";

import type { PickedElement } from "../runtime-protocol";
import { acceptPick, type Picked } from "./pick";

const element = (line: number, prop?: string): PickedElement => ({
  kind: "text",
  style: {
    backgroundColor: null,
    color: "#000000",
    fontSize: 40,
    fontStyle: "normal",
    fontWeight: 400,
    letterSpacing: 0,
    lineHeight: 1.2,
    opacity: 1,
    textAlign: "start",
  },
  tag: "h2",
  target: {
    column: 4,
    line,
    slide: "intro",
    ...(prop ? { part: "title", prop } : {}),
  },
  text: "Q3",
  theme: [],
});

const picked: Picked = { element: element(5), epoch: 2 };

describe("acceptPick", () => {
  it("takes a pick the person made in the slide", () => {
    expect(
      acceptPick({
        current: null,
        epoch: 2,
        from: { epoch: 2, focused: true },
        incoming: element(9),
      })
    ).toBe(true);
  });

  it("takes the picked element drawn again, without the focus", () => {
    expect(
      acceptPick({
        current: picked,
        epoch: 2,
        from: { epoch: 2, focused: false },
        incoming: element(5),
      })
    ).toBe(true);
  });

  it("refuses a pick the deck's own code posts while the person is elsewhere", () => {
    expect(
      acceptPick({
        current: picked,
        epoch: 2,
        from: { epoch: 2, focused: false },
        incoming: element(9),
      })
    ).toBe(false);
    expect(
      acceptPick({
        current: picked,
        epoch: 2,
        from: { epoch: 2, focused: false },
        incoming: element(5, "title"),
      })
    ).toBe(false);
  });

  it("refuses a pick from a deck drawn before the source changed", () => {
    expect(
      acceptPick({
        current: null,
        epoch: 3,
        from: { epoch: 2, focused: true },
        incoming: element(5),
      })
    ).toBe(false);
  });
});

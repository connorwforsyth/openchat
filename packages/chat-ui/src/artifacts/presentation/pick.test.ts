import { describe, expect, it } from "vitest";

import type { PickedElement } from "../runtime-protocol";
import { judgePick, nextPick, type Picked } from "./pick";

const element = (
  line: number,
  { slide = "intro", text = "Q3" }: { slide?: string; text?: string } = {}
): PickedElement => ({
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
  target: { column: 4, line, slide },
  text,
  theme: [],
});

const picked: Picked = { element: element(5), epoch: 2 };
const judge = (
  incoming: PickedElement | null,
  from: { epoch: number; focused: boolean },
  current: Picked | null = picked
) => judgePick({ current, epoch: 2, focus: "intro", from, incoming });

describe("judgePick", () => {
  it("takes what the person clicked in the slide shown, or clicking nothing", () => {
    expect(judge(element(9), { epoch: 2, focused: true }, null)).toBe("take");
    expect(judge(null, { epoch: 2, focused: true })).toBe("take");
  });

  it("refreshes the picked element drawn again, without the focus", () => {
    expect(judge(element(5), { epoch: 2, focused: false })).toBe("refresh");
  });

  it("ignores what the deck's own code posts while the person is elsewhere", () => {
    expect(judge(element(9), { epoch: 2, focused: false })).toBe("ignore");
    expect(judge(null, { epoch: 2, focused: false })).toBe("ignore");
  });

  it("ignores a pick on another slide, even with the focus", () => {
    expect(
      judge(element(5, { slide: "close" }), { epoch: 2, focused: true })
    ).toBe("ignore");
  });

  it("ignores a pick from a deck drawn before the source changed", () => {
    expect(judge(element(5), { epoch: 1, focused: true })).toBe("ignore");
  });
});

describe("nextPick", () => {
  it("keeps the editor's own words on a refresh, taking only the styles", () => {
    const drawn = { ...element(5, { text: "Owned" }), kind: "box" as const };
    const next = nextPick(picked, drawn, "refresh", 2);
    expect(next?.element.text).toBe("Q3");
    expect(next?.element.kind).toBe("text");
    expect(next?.element.style).toBe(drawn.style);
  });

  it("changes nothing when ignored", () => {
    expect(nextPick(picked, element(9), "ignore", 2)).toBe(picked);
  });
});

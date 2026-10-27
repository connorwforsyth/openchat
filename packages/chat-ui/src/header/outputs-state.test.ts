import { describe, expect, it } from "vitest";

import {
  initialOutputs,
  leaveChat,
  outputsShown,
  toggleOutputs,
} from "./outputs-state";

const wide = { filled: true, roomy: true };
const narrow = { filled: true, roomy: false };

describe("the outputs card's state", () => {
  it("stays open where there's room until it's collapsed", () => {
    const open = initialOutputs(true);
    expect(outputsShown(open, wide)).toBe(true);
    const collapsed = toggleOutputs(open, wide);
    expect(collapsed.pinned).toBe(false);
    expect(outputsShown(collapsed, wide)).toBe(false);
    expect(outputsShown(toggleOutputs(collapsed, wide), wide)).toBe(true);
  });

  it("only peeks on a narrow column, leaving the pinned choice alone", () => {
    const open = initialOutputs(true);
    expect(outputsShown(open, narrow)).toBe(false);
    const peeking = toggleOutputs(open, narrow);
    expect(outputsShown(peeking, narrow)).toBe(true);
    const closed = toggleOutputs(peeking, narrow);
    expect(outputsShown(closed, narrow)).toBe(false);
    expect(closed.pinned).toBe(true);
    expect(outputsShown(closed, wide)).toBe(true);
  });

  it("keeps out of an empty chat's way unless it's asked for", () => {
    const empty = { filled: false, roomy: true };
    const open = initialOutputs(true);
    expect(outputsShown(open, empty)).toBe(false);
    const asked = toggleOutputs(open, empty);
    expect(outputsShown(asked, empty)).toBe(true);
    expect(outputsShown(leaveChat(asked), empty)).toBe(false);
    expect(leaveChat(asked).pinned).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { instructionState } from "./instruction";

describe("instructionState", () => {
  it("follows a request from sent to done", () => {
    expect(
      instructionState({ failed: false, sending: false, status: null })
    ).toBe("idle");
    expect(
      instructionState({ failed: false, sending: true, status: null })
    ).toBe("sending");
    expect(
      instructionState({ failed: false, sending: false, status: undefined })
    ).toBe("working");
    expect(
      instructionState({ failed: false, sending: false, status: "running" })
    ).toBe("working");
    expect(
      instructionState({
        failed: false,
        sending: false,
        status: "awaiting_approval",
      })
    ).toBe("approval");
    expect(
      instructionState({ failed: false, sending: false, status: "succeeded" })
    ).toBe("done");
  });

  it("says when it didn't go through", () => {
    expect(
      instructionState({ failed: true, sending: false, status: null })
    ).toBe("failed");
    expect(
      instructionState({ failed: false, sending: false, status: "cancelled" })
    ).toBe("failed");
  });
});

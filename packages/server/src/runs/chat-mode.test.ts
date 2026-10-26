import type { RunOptions } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import { newChatMode, runWithChatModes } from "./chat-mode";

const run = (options: RunOptions) => ({ id: "r1", options });

describe("runWithChatModes", () => {
  it("drops a stored mode while features.chatModes is off", () => {
    const queued = run({
      chatMode: "chat",
      sandbox: "auto",
      webSearch: "auto",
    });
    expect(runWithChatModes(queued, false)).toEqual(
      run({ sandbox: "auto", webSearch: "auto" })
    );
  });

  it("keeps it while the switch is on", () => {
    const queued = run({
      chatMode: "chat",
      sandbox: "auto",
      webSearch: "auto",
    });
    expect(runWithChatModes(queued, true)).toBe(queued);
  });
});

describe("newChatMode", () => {
  it("is Code while the switch is off, and what was asked while it's on", () => {
    expect(newChatMode(false, "chat")).toBe("code");
    expect(newChatMode(true, "chat")).toBe("chat");
    expect(newChatMode(true, undefined)).toBeUndefined();
  });
});

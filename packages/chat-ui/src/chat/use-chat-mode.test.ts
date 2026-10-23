import type { ConversationId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import { shownChatMode } from "./use-chat-mode";

const a = "0190a000-0000-7000-8000-00000000000a" as ConversationId;
const b = "0190a000-0000-7000-8000-00000000000b" as ConversationId;

describe("the switch's mode", () => {
  it("is Chat for a new chat nobody switched", () => {
    expect(shownChatMode(null, undefined, null)).toBe("chat");
  });

  it("is the chat's own, until someone switches it", () => {
    expect(shownChatMode(a, "code", null)).toBe("code");
    expect(shownChatMode(a, "code", { conversationId: a, mode: "chat" })).toBe(
      "chat"
    );
  });

  it("carries a new chat's choice until the created chat loads", () => {
    const chosen = { conversationId: null, mode: "code" } as const;
    expect(shownChatMode(null, undefined, chosen)).toBe("code");
    expect(shownChatMode(a, undefined, chosen)).toBe("code");
    expect(shownChatMode(a, "chat", chosen)).toBe("chat");
  });

  it("doesn't carry one chat's switch into another", () => {
    expect(shownChatMode(b, "chat", { conversationId: a, mode: "code" })).toBe(
      "chat"
    );
  });
});

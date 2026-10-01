import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { composerPlacement } from "./composer-dock";

describe("composerPlacement", () => {
  const id = fixtureId("conversation", 1);

  it("centres a new chat until its first send", () => {
    expect(
      composerPlacement({ conversationId: null, messageCount: 0, sent: false })
    ).toBe("center");
    expect(
      composerPlacement({ conversationId: null, messageCount: 0, sent: true })
    ).toBe("bottom");
  });

  it("keeps a chat that has an address or messages at the bottom", () => {
    expect(
      composerPlacement({ conversationId: id, messageCount: 0, sent: false })
    ).toBe("bottom");
    expect(
      composerPlacement({ conversationId: null, messageCount: 2, sent: false })
    ).toBe("bottom");
  });
});

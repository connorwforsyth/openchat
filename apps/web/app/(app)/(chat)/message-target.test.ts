import type { RunTarget } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import { messageTarget } from "./message-target";

const echo: RunTarget = { model: "mock:echo", type: "model" };
const parrot: RunTarget = { model: "mock:parrot", type: "model" };
const auto: RunTarget = { model: "auto", type: "model" };

describe("messageTarget (111)", () => {
  it("sends nothing while an open chat is loading, even with a guess or a user default", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chosen: null,
        fallback: auto,
        openChatLoading: true,
        userDefault: parrot,
      })
    ).toBeNull();
  });

  it("sends the open chat's own target once it has loaded", () => {
    expect(
      messageTarget({
        chatDefault: echo,
        chosen: null,
        fallback: auto,
        openChatLoading: false,
        userDefault: parrot,
      })
    ).toEqual(echo);
  });

  it("sends a pick made in this tab, loading or not", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chosen: parrot,
        fallback: null,
        openChatLoading: true,
        userDefault: undefined,
      })
    ).toEqual(parrot);
  });

  it("sends nothing for a new chat until the model list gives a guess", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chosen: null,
        fallback: null,
        openChatLoading: false,
        userDefault: undefined,
      })
    ).toBeNull();
    expect(
      messageTarget({
        chatDefault: undefined,
        chosen: null,
        fallback: echo,
        openChatLoading: false,
        userDefault: undefined,
      })
    ).toEqual(echo);
  });
});

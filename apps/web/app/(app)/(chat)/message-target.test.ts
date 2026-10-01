import type { RunTarget } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import { messageTarget, shownTarget } from "./message-target";

const echo: RunTarget = { model: "mock:echo", type: "model" };
const parrot: RunTarget = { model: "mock:parrot", type: "model" };
const auto: RunTarget = { model: "auto", type: "model" };

describe("messageTarget (111)", () => {
  it("sends nothing while an open chat is loading, even with a guess or a user default", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chatLoading: true,
        chosen: null,
        fallback: auto,
        userDefault: parrot,
      })
    ).toBeNull();
  });

  it("sends the open chat's own target once it has loaded", () => {
    expect(
      messageTarget({
        chatDefault: echo,
        chatLoading: false,
        chosen: null,
        fallback: auto,
        userDefault: parrot,
      })
    ).toEqual(echo);
  });

  it("sends a pick made in this tab, loading or not", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chatLoading: true,
        chosen: parrot,
        fallback: null,
        userDefault: undefined,
      })
    ).toEqual(parrot);
  });

  it("sends nothing for a new chat until the model list gives a guess", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chatLoading: false,
        chosen: null,
        fallback: null,
        userDefault: undefined,
      })
    ).toBeNull();
    expect(
      messageTarget({
        chatDefault: undefined,
        chatLoading: false,
        chosen: null,
        fallback: echo,
        userDefault: undefined,
      })
    ).toEqual(echo);
  });
});

describe("a pick in the open chat wins over its late details (132)", () => {
  const gpt: RunTarget = { model: "mock:openai/gpt-5.2", type: "model" };

  it("sends the pick, though the chat's details still say the old model", () => {
    expect(
      messageTarget({
        chatDefault: echo,
        chatLoading: false,
        chosen: gpt,
        fallback: auto,
        pickedHere: gpt,
        userDefault: parrot,
      })
    ).toEqual(gpt);
  });

  it("sends the pick while the chat is still loading", () => {
    expect(
      messageTarget({
        chatDefault: undefined,
        chatLoading: true,
        chosen: gpt,
        fallback: null,
        pickedHere: gpt,
        userDefault: undefined,
      })
    ).toEqual(gpt);
  });

  it("shows the pick over the chat's details, and those over a pick in another chat", () => {
    expect(
      shownTarget({
        chatDefault: echo,
        chosen: gpt,
        fallback: auto,
        pickedHere: gpt,
        userDefault: parrot,
      })
    ).toEqual(gpt);
    expect(
      shownTarget({
        chatDefault: echo,
        chosen: gpt,
        fallback: auto,
        pickedHere: undefined,
        userDefault: parrot,
      })
    ).toEqual(echo);
    expect(
      shownTarget({
        chatDefault: undefined,
        chosen: undefined,
        fallback: auto,
        pickedHere: undefined,
        userDefault: undefined,
      })
    ).toEqual(auto);
  });
});

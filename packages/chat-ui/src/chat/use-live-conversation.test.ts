import type { MessageId, UserId } from "@workspace/contract/schemas/common";
import { TYPING_TTL_MS } from "@workspace/contract/schemas/conversations";
import { describe, expect, it } from "vitest";

import { liveReducer, NOBODY } from "./use-live-conversation";

const maya = { email: null, id: "u-maya" as UserId, image: null, name: "Maya" };
const ada = { email: null, id: "u-ada" as UserId, image: null, name: "Ada" };

describe("liveReducer", () => {
  it("shows who's here from the latest presence", () => {
    const state = liveReducer(NOBODY, {
      event: { type: "presence", users: [ada, maya] },
      now: 0,
      type: "event",
    });
    expect(state.present).toEqual([ada, maya]);
  });

  it("keeps a typist until the TTL lapses, refreshed by each signal", () => {
    let state = liveReducer(NOBODY, {
      event: { type: "typing", user: maya },
      now: 0,
      type: "event",
    });
    state = liveReducer(state, {
      event: { type: "typing", user: maya },
      now: 1000,
      type: "event",
    });
    expect(state.typing.map(({ user }) => user)).toEqual([maya]);
    expect(
      liveReducer(state, { now: TYPING_TTL_MS + 500, type: "tick" }).typing
    ).toHaveLength(1);
    expect(
      liveReducer(state, { now: TYPING_TTL_MS + 1000, type: "tick" }).typing
    ).toEqual([]);
  });

  it("ends a person's typing when their message lands", () => {
    const typing = liveReducer(NOBODY, {
      event: { type: "typing", user: maya },
      now: 0,
      type: "event",
    });
    const sent = liveReducer(typing, {
      event: {
        authorId: maya.id,
        messageId: "m1" as MessageId,
        type: "message",
      },
      now: 10,
      type: "event",
    });
    expect(sent.typing).toEqual([]);
  });
});

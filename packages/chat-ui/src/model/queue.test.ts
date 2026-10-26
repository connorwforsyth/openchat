import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import { queuedTurns, queueFailureOf, withoutQueued } from "./queue";

const ME = "u-me" as never;
const SOMEONE = "u-someone" as never;

const at = "2026-10-27T00:00:00.000Z";

const queuedRun = (
  id: string,
  position: number,
  delivery?: "queue" | "steer",
  createdBy: string = ME
): Run =>
  ({
    assistantMessageId: null,
    createdBy,
    id,
    options: delivery ? { delivery } : undefined,
    state: { afterRunId: "r0", position, status: "queued" },
    userMessageId: `m-${id}`,
  }) as unknown as Run;

const runningRun = {
  assistantMessageId: "a0",
  id: "r0",
  state: { startedAt: at, status: "running" },
  userMessageId: "m-r0",
} as unknown as Run;

const said = (id: string, text: string): Message =>
  ({ id, parts: [{ text, type: "text" }], role: "user" }) as unknown as Message;

describe("queuedTurns", () => {
  it("lists queued turns next first, with their text and how they go", () => {
    const turns = queuedTurns(
      [queuedRun("r2", 2, "steer", SOMEONE), queuedRun("r1", 1), runningRun],
      [said("m-r1", "Later."), said("m-r2", "Focus on b.")],
      ME
    );
    expect(turns).toEqual([
      {
        delivery: "queue",
        messageId: "m-r1",
        mine: true,
        position: 1,
        runId: "r1",
        text: "Later.",
      },
      {
        delivery: "steer",
        messageId: "m-r2",
        mine: false,
        position: 2,
        runId: "r2",
        text: "Focus on b.",
      },
    ]);
  });

  it("has no text for a message the page doesn't have yet", () => {
    expect(queuedTurns([queuedRun("r1", 1)], [], ME)[0]?.text).toBeNull();
    expect(queuedTurns(undefined, [], ME)).toEqual([]);
  });
});

describe("withoutQueued", () => {
  it("leaves queued messages out of the transcript", () => {
    const shown = [said("m-r0", "Go."), said("m-r1", "Later.")];
    const turns = queuedTurns([queuedRun("r1", 1)], shown, ME);
    expect(withoutQueued(shown, turns).map((message) => message.id)).toEqual([
      "m-r0",
    ]);
    expect(withoutQueued(shown, [])).toBe(shown);
  });
});

describe("queueFailureOf", () => {
  it("says why the server refused", () => {
    expect(queueFailureOf({ code: "FORBIDDEN" })).toBe("forbidden");
    expect(queueFailureOf({ code: "CONFLICT" })).toBe("finished");
    expect(queueFailureOf({ code: "NOT_FOUND" })).toBe("finished");
    expect(queueFailureOf(new Error("offline"))).toBe("failed");
  });
});

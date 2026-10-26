import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import {
  answerPhases,
  runToFollow,
  stoppableRun,
  unseenApprovals,
  unsettledCalls,
  waitingCalls,
  waitingForPerson,
} from "./run-activity";

const at = "2026-09-30T00:00:00.000Z";

const run = (id: string, state: Run["state"], answerId = `m-${id}`): Run =>
  ({ assistantMessageId: answerId, id, state }) as unknown as Run;

const running = run("r1", { startedAt: at, status: "running" });
const queued = run(
  "r2",
  { afterRunId: "r1" as never, position: 1, status: "queued" },
  null as never
);
const waiting = run("r3", {
  approvals: [
    { input: {}, requestedAt: at, toolCallId: "c1", toolName: "write" },
  ],
  startedAt: at,
  status: "awaiting_approval",
});

const answer = (parts: Message["parts"]) =>
  ({ id: "m-r3", parts, role: "assistant" }) as unknown as Message;
type Approval = Extract<
  Message["parts"][number],
  { type: "tool-call" }
>["approval"];
const callWith = (
  toolCallId: string,
  approval: Approval
): Message["parts"][number] => ({
  approval,
  input: {},
  toolCallId,
  toolName: "write",
  type: "tool-call",
});
const pendingCall = (toolCallId: string): Message["parts"][number] =>
  callWith(toolCallId, { requestedAt: at, state: "pending" });

describe("run activity", () => {
  it("maps unfinished answers to how their run is doing", () => {
    expect([...answerPhases([queued, running, waiting])]).toEqual([
      ["m-r1", "running"],
      ["m-r3", "waiting"],
    ]);
    expect(answerPhases(undefined).size).toBe(0);
  });

  it("stops the answering run, not one queued behind it", () => {
    expect(stoppableRun([queued, running])?.id).toBe("r1");
    expect(stoppableRun([queued, waiting])?.id).toBe("r3");
    expect(stoppableRun([queued])).toBeNull();
  });

  it("follows a waiting run too, and waits for the list", () => {
    expect(runToFollow(undefined)).toBeUndefined();
    expect(runToFollow([])).toBeNull();
    expect(runToFollow([waiting])).toBe("r3");
  });

  it("follows the answer being written, not a turn queued behind it", () => {
    // Newest first, as the list comes: the queued turn is newer.
    expect(runToFollow([queued, running])).toBe("r1");
    const later = run(
      "r4",
      { afterRunId: "r2" as never, position: 2, status: "queued" },
      null as never
    );
    expect(runToFollow([later, queued])).toBe("r2");
  });

  it("waits for the person only while a card is up and nothing is on its way", () => {
    const pending = waitingCalls([answer([pendingCall("c1")])]);
    expect(pending).toEqual(["c1"]);
    expect(waitingForPerson({ pending, sending: new Set() })).toBe(true);
    expect(waitingForPerson({ pending, sending: new Set(["c1"]) })).toBe(false);
    expect(waitingForPerson({ pending: [], sending: new Set() })).toBe(false);
  });

  it("doesn't count a call a stopped run left, which has its result", () => {
    const stopped = answer([
      pendingCall("c1"),
      {
        output: { message: "Not run", status: "error" },
        toolCallId: "c1",
        toolName: "write",
        type: "tool-result",
      },
    ]);
    expect(waitingCalls([stopped])).toEqual([]);
  });

  it("counts a call as settled once decided or answered, not before its card (136)", () => {
    const replaying = answer([callWith("c1", { state: "not-required" })]);
    // A replay that has the call but not its card yet: no longer waiting,
    // but not settled either, so a decision on its way is kept.
    expect(waitingCalls([replaying])).toEqual([]);
    expect(unsettledCalls([replaying])).toEqual(["c1"]);
    expect(unsettledCalls([answer([pendingCall("c1")])])).toEqual(["c1"]);
    const decided = answer([
      callWith("c1", {
        decidedAt: at,
        decidedBy: "u1" as never,
        decision: { decision: "approve" },
        state: "decided",
      }),
    ]);
    expect(unsettledCalls([decided])).toEqual([]);
    const answered = answer([
      pendingCall("c1"),
      {
        output: { message: "Not run", status: "error" },
        toolCallId: "c1",
        toolName: "write",
        type: "tool-result",
      },
    ]);
    expect(unsettledCalls([answered])).toEqual([]);
  });

  it("notices a call the waiting run asks about that the screen lacks", () => {
    expect(unseenApprovals([waiting], [answer([])])).toEqual(["c1"]);
    expect(unseenApprovals([waiting], [answer([pendingCall("c1")])])).toEqual(
      []
    );
  });
});

import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";
import { describe, expect, it } from "vitest";

import { queuedTurns } from "../model/queue";
import { chatTasks } from "./chat-tasks";

const at = "2026-10-27T00:00:00.000Z";

const run = (id: string, state: Run["state"], answerId: string | null): Run =>
  ({
    assistantMessageId: answerId,
    id,
    state,
    userMessageId: `m-${id}`,
  }) as unknown as Run;

const queued = (id: string, position: number, delivery: "queue" | "steer") =>
  ({
    ...run(id, { afterRunId: "r0", position, status: "queued" } as never, null),
    options: { delivery },
  }) as unknown as Run;

const said = (id: string, text: string): Message =>
  ({ id, parts: [{ text, type: "text" }], role: "user" }) as unknown as Message;

const answer = (id: string, parts: unknown[]): Message =>
  ({ id, parts, role: "assistant" }) as unknown as Message;

const call = (toolCallId: string, toolName: string) => ({
  approval: { state: "none" },
  input: {},
  toolCallId,
  toolName,
  type: "tool-call",
});

describe("chatTasks", () => {
  it("lists the answer being written, then the turns waiting, next first", () => {
    const runs = [
      queued("r2", 2, "steer"),
      queued("r1", 1, "queue"),
      run("r0", { startedAt: at, status: "running" }, "a0"),
    ];
    const messages = [
      said("m-r0", "Make a deck."),
      answer("a0", []),
      said("m-r1", "Then a site."),
      said("m-r2", "Use blue."),
    ];
    const tasks = chatTasks(runs, queuedTurns(runs, messages), messages);
    expect(
      tasks.map(({ messageId, status, text }) => ({ messageId, status, text }))
    ).toEqual([
      { messageId: "a0", status: "running", text: "Make a deck." },
      { messageId: "m-r1", status: "queued", text: "Then a site." },
      { messageId: "m-r2", status: "steering", text: "Use blue." },
    ]);
  });

  it("names the tool call the answer is on, not one that finished", () => {
    const runs = [run("r0", { startedAt: at, status: "running" }, "a0")];
    const messages = [
      answer("a0", [
        call("c1", "web_search"),
        { output: {}, toolCallId: "c1", type: "tool-result" },
        call("c2", "create_artifact"),
      ]),
    ];
    const [task] = chatTasks(runs, [], messages);
    expect(task?.step?.toolCallId).toBe("c2");
    expect(chatTasks(runs, [], [answer("a0", [])])[0]?.step).toBeNull();
  });

  it("says an answer waits on a decision, and skips runs that ended", () => {
    const runs = [
      run(
        "r0",
        { approvals: [], since: at, status: "awaiting_approval" } as never,
        null
      ),
      run("r9", { endedAt: at, status: "succeeded" } as never, "a9"),
    ];
    expect(chatTasks(runs, [], [])).toEqual([
      {
        messageId: "m-r0",
        runId: "r0",
        status: "waiting",
        step: null,
        text: null,
      },
    ]);
    expect(chatTasks(undefined, [], [])).toEqual([]);
  });
});

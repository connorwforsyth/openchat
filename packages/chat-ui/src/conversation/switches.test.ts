import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type { Message } from "@workspace/contract/schemas/messages";
import { describe, expect, it } from "vitest";

import { answerSwitches } from "./switches";

const ECHO = "mock:echo";
const PARROT = "mock:parrot";
const helper = fixtureId("libraryItem", 1);
const reviewer = fixtureId("libraryItem", 2);

const message = (
  n: number,
  role: Message["role"],
  who: { agent?: typeof helper | null; model?: string | null } = {}
): Message => ({
  agent:
    who.agent === undefined || who.agent === null
      ? null
      : { id: who.agent, versionId: fixtureId("libraryVersion", n) },
  authorId: null,
  conversationId: fixtureId("conversation", 1),
  createdAt: fixtureTime(n),
  id: fixtureId("message", n),
  model: role === "assistant" ? (who.model ?? ECHO) : null,
  parentId: n === 1 ? null : fixtureId("message", n - 1),
  parts: [{ text: `message ${n}`, type: "text" }],
  partsVersion: 1,
  role,
  runId: null,
  status: "complete",
  usage: null,
});

const user = (n: number) => message(n, "user");
const answer = (n: number, who: Parameters<typeof message>[2] = {}) =>
  message(n, "assistant", who);

describe("answerSwitches", () => {
  it("marks nothing when the same model answers throughout", () => {
    const branch = [user(1), answer(2), user(3), answer(4)];
    expect(answerSwitches(branch).size).toBe(0);
  });

  it("never marks the first answer", () => {
    const branch = [user(1), answer(2, { agent: helper, model: PARROT })];
    expect(answerSwitches(branch).size).toBe(0);
  });

  it("marks the answer whose model changed, and only that one", () => {
    const branch = [
      user(1),
      answer(2),
      user(3),
      answer(4, { model: PARROT }),
      user(5),
      answer(6, { model: PARROT }),
    ];
    expect([...answerSwitches(branch)]).toEqual([
      [fixtureId("message", 4), { kind: "model", model: PARROT }],
    ]);
  });

  it("marks switching back", () => {
    const branch = [
      user(1),
      answer(2),
      user(3),
      answer(4, { model: PARROT }),
      user(5),
      answer(6),
    ];
    expect([...answerSwitches(branch).values()]).toEqual([
      { kind: "model", model: PARROT },
      { kind: "model", model: ECHO },
    ]);
  });

  it("names the agent when the agent changes, with no model when it's the same", () => {
    const branch = [
      user(1),
      answer(2),
      user(3),
      answer(4, { agent: helper }),
      user(5),
      answer(6, { agent: reviewer }),
    ];
    expect([...answerSwitches(branch).values()]).toEqual([
      { agentId: helper, kind: "agent", model: null },
      { agentId: reviewer, kind: "agent", model: null },
    ]);
  });

  it("lets the agent win when both change, keeping the new model", () => {
    const branch = [
      user(1),
      answer(2),
      user(3),
      answer(4, { agent: helper, model: PARROT }),
    ];
    expect(answerSwitches(branch).get(fixtureId("message", 4))).toEqual({
      agentId: helper,
      kind: "agent",
      model: PARROT,
    });
  });

  it("treats a new version of the same agent as no change", () => {
    // `message` gives each answer its own version id.
    const branch = [
      user(1),
      answer(2, { agent: helper }),
      user(3),
      answer(4, { agent: helper }),
    ];
    expect(answerSwitches(branch).size).toBe(0);
  });

  it("marks leaving an agent for a plain model as a model switch", () => {
    const branch = [user(1), answer(2, { agent: helper }), user(3), answer(4)];
    expect(answerSwitches(branch).get(fixtureId("message", 4))).toEqual({
      kind: "model",
      model: ECHO,
    });
  });

  it("skips an answer that doesn't say who wrote it yet", () => {
    // A live answer has no model until its stored copy arrives: no marker
    // on it, and the one after compares with the answer before it.
    const branch = [
      user(1),
      answer(2),
      user(3),
      { ...answer(4, { model: PARROT }), model: null },
      user(5),
      answer(6),
    ];
    expect(answerSwitches(branch).size).toBe(0);
  });
});

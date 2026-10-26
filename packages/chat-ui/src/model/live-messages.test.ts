import { STEER_DATA, type SteerData } from "@workspace/ai/messages/steer";
import { fixtureId, userAda } from "@workspace/contract/fixtures";
import type {
  ApprovalState,
  MessagePart,
} from "@workspace/contract/schemas/message-parts";
import { newId } from "@workspace/shared/ids";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { treeMessages } from "../fixtures";

import {
  answerIdOf,
  caughtUp,
  type Decisions,
  liveParts,
  liveTail,
  mergeLive,
} from "./live-messages";

const ui = (id: string, role: UIMessage["role"], text: string): UIMessage => ({
  id,
  parts: [{ text, type: "text" }],
  role,
});

describe("liveTail", () => {
  it("keeps only what the stored path doesn't have yet", () => {
    const live = [
      ui("a", "user", "1"),
      ui("b", "assistant", "2"),
      ui("c", "user", "3"),
    ];
    expect(liveTail(new Set(["a", "b"]), live).map((m) => m.id)).toEqual(["c"]);
    expect(liveTail(new Set(), live)).toHaveLength(3);
    expect(liveTail(new Set(["c"]), live)).toEqual([]);
  });
});

describe("mergeLive", () => {
  const path = treeMessages.slice(0, 2);
  const context = {
    authorId: userAda.id,
    conversationId: path[0]?.conversationId ?? fixtureId("conversation", 1),
    now: "2026-09-27T10:00:00.000Z",
  };

  it("chains the live tail onto the stored path", () => {
    const merged = mergeLive(
      path,
      [ui("q", "user", "Next?"), ui("r", "assistant", "Streaming")],
      context
    );
    expect(merged.map((m) => m.id)).toEqual([
      path[0]?.id,
      path[1]?.id,
      "q",
      "r",
    ]);
    expect(merged[2]?.parentId).toBe(path[1]?.id);
    expect(merged[2]?.authorId).toBe(userAda.id);
    expect(merged[3]?.parentId).toBe("q");
    expect(merged[3]?.parts).toEqual([{ text: "Streaming", type: "text" }]);
  });

  it("returns the path itself when nothing is live, and reuses cached rows", () => {
    expect(mergeLive(path, [], context)).toBe(path);
    const cache = new WeakMap();
    const question = ui("q", "user", "Next?");
    const first = mergeLive(
      path,
      [question, ui("r", "assistant", "a")],
      context,
      cache
    );
    const second = mergeLive(
      path,
      [question, ui("r", "assistant", "ab")],
      context,
      cache
    );
    expect(second[2]).toBe(first[2]);
    expect(second[3]).not.toBe(first[3]);
  });

  it("shows the streaming message live where the path already stores it", () => {
    const [question, answer] = path;
    if (!(question && answer)) {
      throw new Error("fixture path is too short");
    }
    const placeholder = { ...answer, parts: [], status: "partial" as const };
    const stored = [question, placeholder];
    const streaming = ui(answer.id, "assistant", "Half an ans");
    const merged = mergeLive(
      stored,
      [streaming],
      context,
      undefined,
      answer.id
    );
    expect(merged.map((m) => m.id)).toEqual([question.id, answer.id]);
    expect(merged[1]?.parts).toEqual([{ text: "Half an ans", type: "text" }]);
    expect(merged[1]?.parentId).toBe(placeholder.parentId);
    expect(merged[1]?.createdAt).toBe(placeholder.createdAt);
    // Not streaming (a finished or stopped turn): the stored message wins.
    expect(mergeLive(stored, [streaming], context)).toBe(stored);
  });
});

describe("mergeLive while a picked-up stream replays", () => {
  const [question, answer] = treeMessages;
  const context = {
    authorId: userAda.id,
    conversationId: question?.conversationId ?? fixtureId("conversation", 1),
    now: "2026-09-30T10:00:00.000Z",
  };

  it("keeps the stored answer until the live copy has every call it has", () => {
    if (!(question && answer)) {
      throw new Error("fixture path is too short");
    }
    const call = {
      approval: { requestedAt: context.now, state: "pending" as const },
      input: {},
      toolCallId: "c9",
      toolName: "write",
      type: "tool-call" as const,
    };
    const stored = [
      question,
      { ...answer, parts: [call], status: "partial" as const },
    ];
    const early = ui(answer.id, "assistant", "Replaying…");
    expect(mergeLive(stored, [early], context, undefined, answer.id)[1]).toBe(
      stored[1]
    );
    const caught: UIMessage = {
      id: answer.id,
      parts: [
        {
          approval: { id: "a9" },
          input: {},
          state: "approval-requested",
          toolCallId: "c9",
          type: "tool-write",
        },
      ],
      role: "assistant",
    };
    expect(
      mergeLive(stored, [caught], context, undefined, answer.id)[1]?.parts
    ).toMatchObject([{ toolCallId: "c9", type: "tool-call" }]);
  });

  it("keeps the stored card while the replay has the call but not yet its card (136)", () => {
    if (!(question && answer)) {
      throw new Error("fixture path is too short");
    }
    const call = {
      approval: { requestedAt: context.now, state: "pending" as const },
      input: {},
      toolCallId: "c9",
      toolName: "write",
      type: "tool-call" as const,
    };
    const stored = [
      question,
      { ...answer, parts: [call], status: "partial" as const },
    ];
    // The call's input has replayed; the approval request hasn't yet.
    const called: UIMessage = {
      id: answer.id,
      parts: [
        {
          input: {},
          state: "input-available",
          toolCallId: "c9",
          type: "tool-write",
        },
      ],
      role: "assistant",
    };
    expect(mergeLive(stored, [called], context, undefined, answer.id)[1]).toBe(
      stored[1]
    );
  });
});

describe("caughtUp", () => {
  const at = "2026-09-30T10:00:00.000Z";
  const call = (toolCallId: string, approval: ApprovalState): MessagePart => ({
    approval,
    input: {},
    toolCallId,
    toolName: "write",
    type: "tool-call",
  });
  const result = (toolCallId: string): MessagePart => ({
    output: { status: "success", value: null },
    toolCallId,
    toolName: "write",
    type: "tool-result",
  });
  const pending = { requestedAt: at, state: "pending" } as const;
  const decided = {
    decidedAt: at,
    decidedBy: userAda.id,
    decision: { decision: "approve" },
    state: "decided",
  } as const;
  const called = { state: "not-required" } as const;

  it("needs every stored call, as far along as the stored copy has it", () => {
    const stored = { parts: [call("c1", decided), result("c1")] };
    expect(caughtUp({ parts: [] }, stored)).toBe(false);
    expect(caughtUp({ parts: [call("c1", called)] }, stored)).toBe(false);
    expect(caughtUp({ parts: [call("c1", decided)] }, stored)).toBe(false);
    expect(
      caughtUp({ parts: [call("c1", decided), result("c1")] }, stored)
    ).toBe(true);
  });

  it("takes a card for a call the stored copy only asks about", () => {
    const stored = { parts: [call("c2", pending)] };
    expect(caughtUp({ parts: [call("c2", called)] }, stored)).toBe(false);
    expect(caughtUp({ parts: [call("c2", pending)] }, stored)).toBe(true);
    // Ahead of the stored copy is caught up too.
    expect(caughtUp({ parts: [call("c2", decided)] }, stored)).toBe(true);
    expect(
      caughtUp({ parts: [call("c2", called), result("c2")] }, stored)
    ).toBe(true);
  });

  it("ignores calls the stored copy doesn't have yet", () => {
    expect(caughtUp({ parts: [call("c3", pending)] }, { parts: [] })).toBe(
      true
    );
  });
});

describe("liveParts", () => {
  const decided: Decisions = new Map([
    [
      "c1",
      {
        decidedAt: "2026-09-30T10:00:00.000Z",
        decidedBy: userAda.id,
        decision: { decision: "approve" },
      },
    ],
  ]);
  // After the first approval the stream has the executed call (still
  // carrying its approval) and the next call waiting (072, audit F1).
  const executed = {
    approval: { approved: true, id: "c1" },
    input: { path: "index.html" },
    output: { status: "changed" },
    state: "output-available",
    toolCallId: "c1",
    type: "tool-write",
  } as const;
  const next = {
    approval: { id: "c2" },
    input: { path: "style.css" },
    state: "approval-requested",
    toolCallId: "c2",
    type: "tool-write",
  } as const;
  const kinds = (parts: readonly MessagePart[]) =>
    parts.map((part) =>
      part.type === "tool-call"
        ? `${part.toolCallId}:${part.approval.state}`
        : part.type
    );

  it("keeps the next card after a decision, whether or not the stored answer has it yet", () => {
    const parts = [{ text: "Before", type: "text" as const }, executed, next];
    expect(kinds(liveParts({ parts }))).toEqual([
      "text",
      "c1:decided",
      "tool-result",
      "c2:pending",
    ]);
    const stored = liveParts({ parts }, decided);
    expect(kinds(stored)).toEqual([
      "text",
      "c1:decided",
      "tool-result",
      "c2:pending",
    ]);
    expect(stored[1]).toMatchObject({ approval: { decidedBy: userAda.id } });
  });

  it("shows a call decided as soon as the server has the decision", () => {
    const waiting = { ...next, approval: { id: "c1" }, toolCallId: "c1" };
    expect(kinds(liveParts({ parts: [waiting] }))).toEqual(["c1:pending"]);
    expect(kinds(liveParts({ parts: [waiting] }, decided))).toEqual([
      "c1:decided",
    ]);
  });

  it("drops a call that was stopped undecided of its approval, not of its result", () => {
    const stopped = {
      approval: { id: "c3" },
      errorText: "Not run: the user stopped the agent instead of deciding.",
      input: {},
      state: "output-error",
      toolCallId: "c3",
      type: "tool-write",
    } as const;
    expect(liveParts({ parts: [stopped as never] })).toMatchObject([
      { approval: { state: "not-required" }, type: "tool-call" },
      { output: { status: "error" }, type: "tool-result" },
    ]);
  });

  it("drops only the part that can't be mapped", () => {
    expect(
      kinds(
        liveParts({
          parts: [
            { text: "Before", type: "text" },
            // Not JSON: a part the contract can't store.
            { ...executed, output: () => undefined } as never,
            next,
          ],
        })
      )
    ).toEqual(["text", "c2:pending"]);
  });
});

describe("an answer that took a steer", () => {
  const path = treeMessages.slice(0, 2);
  const [question, stored] = path;
  const context = {
    authorId: userAda.id,
    conversationId: question?.conversationId ?? fixtureId("conversation", 1),
    now: "2026-10-27T10:00:00.000Z",
  };
  const firstAnswer = stored?.id as SteerData["previousAnswerId"];
  const steer: SteerData = {
    answerId: newId("message"),
    message: {
      authorId: userAda.id,
      createdAt: "2026-10-27T10:00:01.000Z",
      id: newId("message"),
      parts: [{ text: "Focus on b.", type: "text" }],
    },
    previousAnswerId: firstAnswer,
  };
  const live: UIMessage = {
    id: firstAnswer,
    parts: [
      { text: "Looking at a.", type: "text" },
      { data: steer, id: steer.message.id, type: `data-${STEER_DATA}` },
      { text: "Now b.", type: "text" },
    ],
    role: "assistant",
  };

  it("shows the steer where the answer took it, and the rest under it", () => {
    const merged = mergeLive(
      path,
      [ui(question?.id ?? "q", "user", "Hi"), live],
      context,
      undefined,
      firstAnswer
    );
    expect(merged.map((message) => message.id)).toEqual([
      question?.id,
      firstAnswer,
      steer.message.id,
      steer.answerId,
    ]);
    const [, before, asked, after] = merged;
    expect(before?.parts).toEqual([{ text: "Looking at a.", type: "text" }]);
    expect(asked).toMatchObject({
      parentId: firstAnswer,
      parts: [{ text: "Focus on b.", type: "text" }],
      role: "user",
    });
    expect(after).toMatchObject({
      parentId: steer.message.id,
      parts: [{ text: "Now b.", type: "text" }],
      role: "assistant",
    });
  });

  it("shows it once when the stored branch already has it", () => {
    const storedSteer = {
      ...(stored as NonNullable<typeof stored>),
      id: steer.message.id,
      parentId: firstAnswer,
      parts: [{ text: "Focus on b.", type: "text" as const }],
      role: "user" as const,
    };
    const storedAnswer = {
      ...(stored as NonNullable<typeof stored>),
      id: steer.answerId,
      parentId: steer.message.id,
      parts: [],
    };
    const merged = mergeLive(
      [...path, storedSteer, storedAnswer],
      [ui(question?.id ?? "q", "user", "Hi"), live],
      context,
      undefined,
      firstAnswer
    );
    expect(merged.map((message) => message.id)).toEqual([
      question?.id,
      firstAnswer,
      steer.message.id,
      steer.answerId,
    ]);
    expect(merged.at(-1)?.parts).toEqual([{ text: "Now b.", type: "text" }]);
  });

  it("writes into the answer the last steer started", () => {
    expect(answerIdOf(live)).toBe(steer.answerId);
    expect(answerIdOf(ui("x", "assistant", "plain"))).toBe("x");
  });
});

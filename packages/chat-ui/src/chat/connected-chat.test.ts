import { pickedSkills, userParts } from "@workspace/client/run-transport";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  editedOutgoing,
  outgoingMessage,
  restoredUnchecked,
  runFailure,
  turnOptions,
} from "./connected-chat";

// What a turn sends: attachments and text as before, plus a
// `data-workspace-file` part per mentioned file (062), which the run
// transport stores and the server reads into the turn (056).

const file = {
  filename: "notes.md",
  mediaType: "text/markdown",
  type: "file" as const,
  url: "/api/files/0192d3a8-0000-7000-8000-000000000001/content",
};

describe("outgoingMessage", () => {
  it("sends text and files as before when nothing is mentioned", () => {
    expect(
      outgoingMessage("hi", { files: [file], workspaceFiles: [] })
    ).toEqual({ files: [file], text: "hi" });
  });

  it("adds a workspace-file part per file, once each, that the transport keeps", () => {
    const sent = outgoingMessage("look at @hello.md", {
      files: [file],
      workspaceFiles: ["hello.md", "notes.md", "hello.md"],
    });
    expect(sent).toEqual({
      parts: [
        file,
        { text: "look at @hello.md", type: "text" },
        { data: { path: "hello.md" }, type: "data-workspace-file" },
        { data: { path: "notes.md" }, type: "data-workspace-file" },
      ],
    });
    if (!("parts" in sent)) {
      throw new Error("expected parts");
    }
    const message = { id: "m", parts: sent.parts, role: "user" } as UIMessage;
    expect(userParts(message)).toEqual([
      expect.objectContaining({ filename: "notes.md", type: "file" }),
      { text: "look at @hello.md", type: "text" },
      { data: { path: "hello.md" }, name: "workspace-file", type: "data" },
      { data: { path: "notes.md" }, name: "workspace-file", type: "data" },
    ]);
  });
});

describe("outgoingMessage with skills (127)", () => {
  it("adds a skills part the transport sends as input.skills, not as a stored part", () => {
    const id = "11111111-1111-4111-8111-111111111111" as never;
    const sent = outgoingMessage("a poem", {
      files: [],
      skills: [{ id, name: "Haiku" }],
      workspaceFiles: [],
    });
    expect(sent).toEqual({
      parts: [
        { text: "a poem", type: "text" },
        { data: { skills: [{ id, name: "Haiku" }] }, type: "data-skills" },
      ],
    });
    if (!("parts" in sent)) {
      throw new Error("expected parts");
    }
    const message = { id: "m", parts: sent.parts, role: "user" } as UIMessage;
    expect(userParts(message)).toEqual([{ text: "a poem", type: "text" }]);
    expect(pickedSkills(message)).toEqual([{ id }]);
  });
});

describe("chips", () => {
  const skill = "11111111-1111-4111-8111-111111111111" as never;
  const versionId = "22222222-2222-4222-8222-222222222222" as never;
  const chips = [
    { end: 6, id: skill, kind: "skill", label: "Haiku", start: 0, versionId },
    { end: 19, kind: "file", label: "a.md", path: "docs/a.md", start: 14 },
  ] as const;

  it("go as a stored data-chips part, with a draft skill's version", () => {
    const sent = outgoingMessage("@Haiku about @a.md", {
      chips: [...chips],
      files: [],
      skills: [{ id: skill, name: "Haiku", versionId }],
      workspaceFiles: [],
    });
    if (!("parts" in sent)) {
      throw new Error("expected parts");
    }
    const message = { id: "m", parts: sent.parts, role: "user" } as UIMessage;
    expect(userParts(message)).toContainEqual({
      data: { chips },
      name: "chips",
      type: "data",
    });
    expect(pickedSkills(message)).toEqual([{ id: skill, versionId }]);
  });

  it("are kept through an edit when their @label is still there", () => {
    const parts = [
      { data: { chips: [...chips] }, name: "chips", type: "data" as const },
    ];
    expect(editedOutgoing("now @Haiku only", parts)).toEqual({
      chips: [{ ...chips[0], end: 10, start: 4 }],
      files: [],
      skills: [{ id: skill, name: "Haiku", versionId }],
      workspaceFiles: [],
    });
  });
});

describe("turnOptions (105)", () => {
  it("leaves the run's options out when everything is at its default", () => {
    expect(turnOptions(false, {})).toBeUndefined();
  });

  it("sends web search, the thinking level and the fast tier", () => {
    expect(turnOptions(true, {})).toEqual({ sandbox: "auto", webSearch: "on" });
    expect(turnOptions(false, { fast: true, reasoning: "low" })).toEqual({
      fast: true,
      reasoning: "low",
      sandbox: "auto",
      webSearch: "auto",
    });
  });
});

describe("turnOptions with plan mode (106)", () => {
  it("asks for a planning run, and nothing else changes", () => {
    expect(turnOptions(false, {}, true)).toEqual({
      mode: "plan",
      sandbox: "auto",
      webSearch: "auto",
    });
    expect(turnOptions(true, { fast: true }, true)).toEqual({
      fast: true,
      mode: "plan",
      sandbox: "auto",
      webSearch: "on",
    });
    // Off, the mode is left out: a normal run.
    expect(turnOptions(true, {}, false)).not.toHaveProperty("mode");
  });
});

describe("restoredUnchecked (136)", () => {
  const shownAt = 1000;
  const query = {
    data: { messages: [] },
    dataUpdatedAt: 500,
    errorUpdatedAt: 0,
    isStale: true,
  };

  it("holds a branch from before the chat was shown until it's refetched", () => {
    expect(restoredUnchecked(query, shownAt)).toBe(true);
    expect(restoredUnchecked({ ...query, dataUpdatedAt: 1500 }, shownAt)).toBe(
      false
    );
  });

  it("trusts fresh data, nothing at all, and a refetch that failed", () => {
    expect(restoredUnchecked({ ...query, isStale: false }, shownAt)).toBe(
      false
    );
    expect(restoredUnchecked({ ...query, data: undefined }, shownAt)).toBe(
      false
    );
    expect(restoredUnchecked({ ...query, errorUpdatedAt: 1200 }, shownAt)).toBe(
      false
    );
  });
});

// What the oRPC client throws: an Error carrying the contract's code.
const orpcError = (code: string) =>
  Object.assign(new Error(code), { code, status: 402 });

describe("runFailure", () => {
  it("names a spent allowance or budget", () => {
    expect(runFailure(orpcError("ALLOWANCE_SPENT"))).toEqual({
      type: "allowance_spent",
    });
    expect(runFailure(orpcError("BUDGET_EXCEEDED"))).toEqual({
      type: "budget_exceeded",
    });
  });

  it("treats anything else as a failed answer", () => {
    expect(runFailure(orpcError("INTERNAL_SERVER_ERROR"))).toEqual({
      type: "failed",
    });
    expect(runFailure(new Error("network"))).toEqual({ type: "failed" });
  });
});

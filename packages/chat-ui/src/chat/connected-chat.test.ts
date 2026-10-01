import { userParts } from "@workspace/client/run-transport";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { outgoingMessage, turnOptions } from "./connected-chat";

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

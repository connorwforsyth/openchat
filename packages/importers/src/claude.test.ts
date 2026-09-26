import { describe, expect, test } from "vitest";

import { parseClaudeConversation } from "./claude";
import { importedConversationSchema } from "./schema";
import { byId, fixture, parents, partOf, partTypes } from "./testing";
import { checkTree } from "./tree";

const [linear, tree] = fixture("claude-conversations.json") as unknown[];

const parse = (raw: unknown) => {
  const result = parseClaudeConversation(raw);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

describe("parseClaudeConversation", () => {
  test("chains a linear export in order", () => {
    const conversation = parse(linear);
    expect(parents(conversation)).toEqual({
      "cm-1": null,
      "cm-2": "cm-1",
      "cm-3": "cm-2",
      "cm-4": "cm-3",
    });
    expect(conversation.title).toBe("Grocery notes");
    expect(conversation.activeLeafSourceId).toBe("cm-4");
    expect(conversation.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(checkTree(conversation.messages).ok).toBe(true);
    expect(importedConversationSchema.safeParse(conversation).success).toBe(
      true
    );
  });

  test("moves a reply stamped before its question to just after it", () => {
    const conversation = parse(linear);
    expect(byId(conversation, "cm-4").createdAt).toBe(
      "2025-01-15T10:01:00.001Z"
    );
  });

  test("keeps attachments as imported-file records with their extracted text", () => {
    const question = byId(parse(linear), "cm-1");
    expect(partTypes(question)).toEqual([
      "text",
      "data:imported-file",
      "data:imported-file",
    ]);
    expect(
      question.parts.slice(1).map((part) => part.type === "data" && part.data)
    ).toEqual([
      {
        extractedText: "Buy milk. Buy bread.",
        filename: "notes.txt",
        origin: "claude",
        sizeBytes: 42,
      },
      { filename: "shelf.png", origin: "claude", ref: "file-uuid-1" },
    ]);
  });

  test("maps thinking, citations and tool use; keeps unknown blocks", () => {
    const answer = byId(parse(linear), "cm-2");
    expect(partTypes(answer)).toEqual([
      "reasoning",
      "text",
      "source",
      "tool-call",
      "tool-result",
      "data:imported-content",
    ]);
    expect(partOf(answer, "source").source).toEqual({
      kind: "url",
      url: "https://example.com/groceries",
    });
    const call = partOf(answer, "tool-call");
    expect(call.toolName).toBe("artifacts");
    expect(call.input).toMatchObject({
      command: "create",
      title: "Shopping list",
    });
    const result = partOf(answer, "tool-result");
    expect(result.toolCallId).toBe(call.toolCallId);
    expect(result.output).toEqual({
      status: "success",
      value: [{ text: "OK", type: "text" }],
    });
    expect(partOf(answer, "data").data).toMatchObject({ kind: "token_budget" });
  });

  test("falls back to `text` when an old export has no content blocks", () => {
    expect(partOf(byId(parse(linear), "cm-4"), "text").text).toBe(
      "You're welcome."
    );
  });

  test("uses parent_message_uuid when every message has one", () => {
    const conversation = parse(tree);
    expect(parents(conversation)).toEqual({
      "ct-a1": "ct-h1",
      "ct-a2": "ct-h2b",
      "ct-h1": null,
      "ct-h2": "ct-a1",
      "ct-h2b": "ct-a1",
    });
    expect(conversation.activeLeafSourceId).toBe("ct-a2");
    expect(byId(conversation, "ct-a2").model).toBe(
      "anthropic:claude-sonnet-4-5"
    );
    expect(byId(conversation, "ct-h1").model).toBeNull();
  });

  test("a conversation without messages is empty", () => {
    expect(
      parseClaudeConversation({ chat_messages: [], uuid: "c" }, 4)
    ).toEqual({
      error: { index: 4, reason: "empty", sourceId: "c" },
      ok: false,
    });
  });
});

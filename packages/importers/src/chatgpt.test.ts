import { describe, expect, test } from "vitest";

import { parseChatGptConversation } from "./chatgpt";
import { importedConversationSchema } from "./schema";
import { byId, fixture, parents, partOf, partTypes } from "./testing";
import { checkTree } from "./tree";

const [branches, citations, systemOnly] = fixture(
  "chatgpt-conversations.json"
) as unknown[];

const parse = (raw: unknown) => {
  const result = parseChatGptConversation(raw, 0, () => new Date(0));
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

describe("parseChatGptConversation", () => {
  test("keeps every branch, not just the path to current_node", () => {
    const conversation = parse(branches);
    expect(parents(conversation)).toEqual({
      a1: "u1",
      a1b: "u1",
      a3: "u2b",
      thoughts: "u2",
      u1: null,
      u2: "a1",
      u2b: "a1",
    });
    expect(conversation.title).toBe("Weekend in Lisbon");
    expect(conversation.sourceId).toBe("conv-branches");
    expect(conversation.createdAt).toBe(
      new Date(1_714_585_000_000).toISOString()
    );
    expect(checkTree(conversation.messages).ok).toBe(true);
    expect(importedConversationSchema.safeParse(conversation).success).toBe(
      true
    );
  });

  test("passes over system prompts, custom instructions and reasoning recaps", () => {
    const ids = parse(branches).messages.map((m) => m.sourceId);
    expect(ids).not.toContain("system");
    expect(ids).not.toContain("context");
    expect(ids).not.toContain("recap");
  });

  test("folds thoughts into the answer after them, with citations as sources", () => {
    const conversation = parse(branches);
    const answer = byId(conversation, "thoughts");
    expect(answer.role).toBe("assistant");
    expect(answer.model).toBe("openai:o3");
    expect(partTypes(answer)).toEqual(["reasoning", "text", "source"]);
    expect(partOf(answer, "reasoning").text).toBe("Public transport is cheap.");
    expect(partOf(answer, "text").text).toBe(
      "Try the tram and free museums on Sunday. ([Lisbon transport](https://example.com/lisbon-transport))"
    );
    expect(partOf(answer, "source")).toEqual({
      id: "source-1",
      source: {
        kind: "url",
        title: "Lisbon transport",
        url: "https://example.com/lisbon-transport",
      },
      type: "source",
    });
    // current_node was the answer, which now lives on the thoughts node.
    expect(conversation.activeLeafSourceId).toBe("thoughts");
  });

  test("turns a tool turn into one assistant message: call, result, answer", () => {
    const turn = byId(parse(branches), "a3");
    expect(partTypes(turn)).toEqual(["tool-call", "tool-result", "text"]);
    expect(partOf(turn, "tool-call")).toEqual({
      approval: { state: "not-required" },
      input: { code: "print(1 + 1)", language: "python" },
      providerExecuted: true,
      toolCallId: "a3",
      toolName: "python",
      type: "tool-call",
    });
    const result = partOf(turn, "tool-result");
    expect(result.toolCallId).toBe("a3");
    expect(result.output).toEqual({
      status: "success",
      value: { content_type: "execution_output", text: "2" },
    });
    expect(partOf(turn, "text").text).toBe("It comes to 2 euros.");
  });

  test("keeps attachments and images as imported-file records", () => {
    const conversation = parse(branches);
    const first = byId(conversation, "u1");
    expect(partTypes(first)).toEqual(["text", "data:imported-file"]);
    expect(partOf(first, "data").data).toEqual({
      filename: "itinerary.pdf",
      mediaType: "application/pdf",
      origin: "chatgpt",
      ref: "file-abc",
      sizeBytes: 2048,
    });
    const edited = byId(conversation, "u2b");
    expect(partTypes(edited)).toEqual(["data:imported-file", "text"]);
    expect(partOf(edited, "data").data).toMatchObject({
      height: 48,
      ref: "file-service://file-img1",
      width: 64,
    });
    expect(edited.model).toBeNull();
  });

  test("swaps content-reference markers and keeps unknown content verbatim", () => {
    const conversation = parse(citations);
    expect(parents(conversation)).toEqual({ "b-a1": "b-u1", "b-u1": null });
    const answer = byId(conversation, "b-a1");
    expect(partOf(answer, "text").text).toBe(
      "The museum opens at ten. ([example.com](https://example.com/museum))"
    );
    expect(partTypes(answer)).toEqual([
      "text",
      "source",
      "data:imported-content",
    ]);
    expect(partOf(answer, "data").data).toEqual({
      content: { content_type: "super_widget", widget: { kind: "map" } },
      kind: "super_widget",
      origin: "chatgpt",
    });
    // The widget node was still in progress.
    expect(answer.status).toBe("partial");
    // An undated message takes the conversation's time.
    expect(byId(conversation, "b-u1").createdAt).toBe(
      new Date(1_714_585_100_000).toISOString()
    );
  });

  test("a conversation of hidden nodes only is empty", () => {
    const result = parseChatGptConversation(systemOnly, 2);
    expect(result).toEqual({
      error: { index: 2, reason: "empty", sourceId: "conv-empty" },
      ok: false,
    });
  });

  test("a malformed conversation is invalid_shape, naming the path only", () => {
    const result = parseChatGptConversation({
      mapping: { x: { message: { author: 1 } } },
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.reason).toBe("invalid_shape");
    expect(!result.ok && result.error.detail).toContain("mapping.x.message");
  });
});

import { describe, expect, test } from "vitest";

import { parseLibreChatExport } from "./librechat";
import { importedConversationSchema } from "./schema";
import { byId, fixture, parents, partOf, partTypes } from "./testing";
import { checkTree } from "./tree";

const parse = (raw: unknown) => {
  const result = parseLibreChatExport(raw);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

describe("parseLibreChatExport", () => {
  test("flattens a recursive export into the same branch tree", () => {
    const conversation = parse(fixture("librechat-tree.json"));
    expect(parents(conversation)).toEqual({
      "lc-a1": "lc-u1",
      "lc-a1b": "lc-u1",
      "lc-a2": "lc-u2",
      "lc-u1": null,
      "lc-u2": "lc-a1",
    });
    expect(conversation.title).toBe("Python venv");
    expect(conversation.sourceId).toBe("lc-tree");
    expect(conversation.createdAt).toBe("2024-05-01T16:35:11.530Z");
    expect(conversation.activeLeafSourceId).toBeNull();
    expect(checkTree(conversation.messages).ok).toBe(true);
    expect(importedConversationSchema.safeParse(conversation).success).toBe(
      true
    );
  });

  test("prefers content parts over text and drops UI-only parts", () => {
    const answer = byId(parse(fixture("librechat-tree.json")), "lc-a2");
    expect(partTypes(answer)).toEqual([
      "reasoning",
      "tool-call",
      "tool-result",
      "text",
    ]);
    expect(partOf(answer, "tool-call")).toMatchObject({
      input: { cmd: "source .venv/bin/activate" },
      toolCallId: "call_1",
      toolName: "shell",
    });
    expect(partOf(answer, "tool-result").output).toEqual({
      status: "success",
      value: "ok",
    });
    expect(answer.model).toBe("agents:gpt-4o-mini");
  });

  test("maps models, files and unfinished messages", () => {
    const conversation = parse(fixture("librechat-tree.json"));
    expect(byId(conversation, "lc-a1").model).toBe("openai:gpt-4o");
    expect(byId(conversation, "lc-a1b").status).toBe("partial");
    const question = byId(conversation, "lc-u1");
    expect(question.role).toBe("user");
    expect(question.model).toBeNull();
    expect(partTypes(question)).toEqual(["text", "data:imported-file"]);
    expect(partOf(question, "data").data).toEqual({
      filename: "requirements.txt",
      mediaType: "text/plain",
      origin: "librechat",
      ref: "lc-file-1",
      sizeBytes: 120,
    });
  });

  test("reads a flat export by parentMessageId, lifting children of empty messages", () => {
    const conversation = parse(fixture("librechat-flat.json"));
    expect(parents(conversation)).toEqual({
      "lf-a1": "lf-u1",
      "lf-a1b": "lf-u1",
      "lf-a2": "lf-a1",
      "lf-u1": null,
    });
    const last = byId(conversation, "lf-a2");
    expect(last.status).toBe("error");
    expect(last.model).toBe("azure:gpt-4");
  });

  test("a message without an id is invalid_shape", () => {
    const result = parseLibreChatExport({
      conversationId: "x",
      messages: [{ text: "hi" }],
    });
    expect(!result.ok && result.error.reason).toBe("invalid_shape");
  });

  test("a deeply nested export doesn't overflow the stack", () => {
    let node: Record<string, unknown> | null = null;
    for (let i = 3000; i >= 0; i -= 1) {
      node = {
        children: node ? [node] : [],
        createdAt: new Date(1_700_000_000_000 + i).toISOString(),
        isCreatedByUser: i % 2 === 0,
        messageId: `m${i}`,
        text: `turn ${i}`,
      };
    }
    const conversation = parse({
      conversationId: "deep",
      messages: [node],
      recursive: true,
    });
    expect(conversation.messages).toHaveLength(3001);
    expect(conversation.messages.at(-1)?.parentSourceId).toBe("m2999");
  });
});

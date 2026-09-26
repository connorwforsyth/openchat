import { UPDATE_MEMORY_TOOL } from "@workspace/ai/memory/prompt";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  MemoryDocument,
  MemoryVersion,
} from "@workspace/contract/schemas/memory";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { upsertGrant } from "@workspace/db/queries/grants";
import { seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import {
  createHarness,
  type Harness,
  readEvents,
  USER_HEADER,
} from "../testing/harness";

// Memory (D20) through the HTTP app: the settings procedures, and the
// `update_memory` tool end to end in a run with a mock model.

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => h.close());

const json = async <T>(response: Response, status = 200): Promise<T> => {
  if (response.status !== status) {
    throw new Error(
      `expected ${status}, got ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

const memory = async () => json<MemoryDocument>(await h.request("/api/memory"));

const putMemory = (content: string, baseVersionId: string | null) =>
  h.request("/api/memory", {
    json: { baseVersionId, content },
    method: "PUT",
  });

const versions = async (query = "") =>
  json<{ items: MemoryVersion[]; nextCursor: string | null }>(
    await h.request(`/api/memory/versions${query}`)
  );

const newConversation = async () =>
  json<Conversation>(
    await h.request("/api/conversations", { json: {}, method: "POST" }),
    201
  );

/** Sends a message and waits for the run (and everything it wrote) to finish. */
const chat = async (conversationId: string, text: string) => {
  const created = await json<CreateRunOutput>(
    await h.request("/api/runs", {
      json: {
        conversationId,
        input: {
          parentId: null,
          parts: [{ text, type: "text" }],
          type: "message",
        },
        target: { model: "test:model", type: "model" },
      },
      method: "POST",
    }),
    202
  );
  await readEvents(await h.request(created.streamUrl));
  await h.services.executor.idle();
  return created;
};

const systemPrompt = (model: MockLanguageModelV4) =>
  model.doStreamCalls[0]?.prompt.find((message) => message.role === "system")
    ?.content;

describe("memory procedures", () => {
  it("starts empty, with the instance cap and auto mode", async () => {
    expect(await memory()).toEqual({
      content: "",
      maxChars: 8000,
      mode: "auto",
      updatedAt: null,
      versionId: null,
    });
    expect(await versions()).toEqual({ items: [], nextCursor: null });
  });

  it("edits as versions, refuses a stale base, and reverts", async () => {
    const first = await json<MemoryDocument>(
      await putMemory("- Prefers pnpm\n", null)
    );
    expect(first).toMatchObject({ content: "- Prefers pnpm\n" });
    expect(first.versionId).not.toBeNull();

    const stale = await putMemory("- Prefers npm\n", null);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "CONFLICT",
      data: { reason: "version_mismatch" },
    });

    await json(await putMemory("- Prefers bun\n", first.versionId));
    const reverted = await json<MemoryDocument>(
      await h.request("/api/memory/revert", {
        json: { versionId: first.versionId },
        method: "POST",
      })
    );
    expect(reverted.content).toBe("- Prefers pnpm\n");

    const page = await versions("?limit=2");
    expect(page.items.map((v) => [v.number, v.source.type])).toEqual([
      [3, "revert"],
      [2, "user"],
    ]);
    expect(page.nextCursor).not.toBeNull();
    const rest = await versions(`?limit=2&cursor=${page.nextCursor}`);
    expect(rest).toMatchObject({ items: [{ number: 1 }], nextCursor: null });

    expect((await h.request("/api/memory/versions?cursor=bm9")).status).toBe(
      422
    );
  });

  it("switches to propose mode and reverts only the caller's versions", async () => {
    expect(
      await json<MemoryDocument>(
        await h.request("/api/memory/mode", {
          json: { mode: "propose" },
          method: "PUT",
        })
      )
    ).toMatchObject({ content: "", mode: "propose" });

    const mine = await json<MemoryDocument>(await putMemory("secret\n", null));
    const stranger = await seedUser(h.db);
    const theirs = await h.request("/api/memory/revert", {
      as: stranger.id,
      json: { versionId: mine.versionId },
      method: "POST",
    });
    expect(theirs.status).toBe(404);
  });

  it("needs a session, and answers FEATURE_DISABLED when memory is off", async () => {
    const signedOut = await createApp({
      resolveSession: () => Promise.resolve(null),
      services: h.services,
    }).request("/api/memory");
    expect(signedOut.status).toBe(401);

    const off = createApp({
      resolveSession: (request) =>
        Promise.resolve({
          userId: request.headers.get(USER_HEADER) as typeof h.ownerId,
        }),
      services: { ...h.services, memory: { enabled: false, maxChars: 8000 } },
    });
    const response = await off.request("/api/memory", {
      headers: { [USER_HEADER]: h.ownerId },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "FEATURE_DISABLED",
      data: { feature: "memory" },
    });
  });
});

describe("update_memory in a run", () => {
  const remember = {
    patches: [{ op: "append", text: "- Prefers pnpm" }],
    summary: "Prefers pnpm",
  };

  it('"remember I prefer pnpm" updates memory, versions it, and the reply says so', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        toolCallStream(UPDATE_MEMORY_TOOL, remember),
        textStream("Got it. I'll remember that you prefer pnpm."),
      ],
    });
    h.nextTurn({ model });
    const conversation = await newConversation();
    const run = await chat(conversation.id, "remember I prefer pnpm");

    expect(systemPrompt(model)).toContain("<memory>\n(empty)\n</memory>");
    expect(model.doStreamCalls[0]?.tools?.map((t) => t.name)).toContain(
      UPDATE_MEMORY_TOOL
    );

    const doc = await memory();
    expect(doc.content).toBe("- Prefers pnpm\n");

    const path = await json<BranchPath>(
      await h.request(`/api/conversations/${conversation.id}/path`)
    );
    const [, answer] = path.messages;
    const [version] = (await versions()).items;
    expect(version).toMatchObject({
      id: doc.versionId,
      number: 1,
      source: {
        conversationId: conversation.id,
        messageId: answer?.id,
        runId: run.runId,
        type: "agent",
      },
    });

    // What the "Memory updated · Undo" note (015) reads.
    expect(answer?.parts).toContainEqual({
      output: {
        status: "success",
        value: {
          number: 1,
          previousVersionId: null,
          status: "applied",
          summary: "Prefers pnpm",
          versionId: doc.versionId,
        },
      },
      toolCallId: "call-1",
      toolName: UPDATE_MEMORY_TOOL,
      type: "tool-result",
    });
    expect(answer?.parts).toContainEqual(
      expect.objectContaining({
        text: "Got it. I'll remember that you prefer pnpm.",
        type: "text",
      })
    );

    // Undo of a first write clears the file, based on the new version.
    const undone = await json<MemoryDocument>(
      await putMemory("", doc.versionId)
    );
    expect(undone.content).toBe("");
  });

  it("injects the file into later chats", async () => {
    await json(await putMemory("- Prefers pnpm\n", null));
    const model = new MockLanguageModelV4({ doStream: textStream("Sure.") });
    h.nextTurn({ model });
    await chat((await newConversation()).id, "set up a project");
    expect(systemPrompt(model)).toContain(
      "<memory>\n- Prefers pnpm\n</memory>"
    );
  });

  it("stays out of shared chats: no file, no tool", async () => {
    await json(await putMemory("- Prefers pnpm\n", null));
    const conversation = await newConversation();
    const friend = await seedUser(h.db);
    await upsertGrant(h.db, {
      grantedBy: h.ownerId,
      permission: "viewer",
      principal: { id: friend.id, type: "user" },
      resource: { resourceId: conversation.id, resourceType: "conversation" },
    });
    const model = new MockLanguageModelV4({ doStream: textStream("Sure.") });
    h.nextTurn({ model });
    await chat(conversation.id, "remember I prefer pnpm");
    expect(systemPrompt(model) ?? "").not.toContain("Prefers pnpm");
    expect(
      (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name)
    ).not.toContain(UPDATE_MEMORY_TOOL);
  });
});

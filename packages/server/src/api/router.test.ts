import { textStream } from "@workspace/ai/testing/mock-models";
import type {
  Conversation,
  Participant,
  ParticipantState,
} from "@workspace/contract/schemas/conversations";
import type {
  Message,
  MessageTree,
} from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../testing/harness";

// The conversations and messages groups through the HTTP app, including the
// access rules: a stranger sees `NOT_FOUND`, never someone else's chat.

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

const answered = async () => {
  h.nextTurn({
    model: new MockLanguageModelV4({ doStream: textStream("Yes.") }),
  });
  const chat = await json<Conversation>(
    await h.request("/api/conversations", {
      json: { title: "Plans" },
      method: "POST",
    }),
    201
  );
  const run = await json<CreateRunOutput>(
    await h.request("/api/runs", {
      json: {
        conversationId: chat.id,
        input: {
          parentId: null,
          parts: [{ text: "Is this on?", type: "text" }],
          type: "message",
        },
        target: { model: "test:model", type: "model" },
      },
      method: "POST",
    }),
    202
  );
  await h.services.executor.idle();
  return { chat, run };
};

describe("conversations", () => {
  it("creates, lists, updates and deletes", async () => {
    const { chat } = await answered();
    expect(chat).toMatchObject({
      context: { type: "personal" },
      myPermission: "owner",
      title: "Plans",
    });
    const listed = await json<{ items: Conversation[] }>(
      await h.request("/api/conversations?limit=10")
    );
    expect(listed.items.map((c) => c.id)).toEqual([chat.id]);
    expect(listed.items[0]?.contextLocked).toBe(true);

    const updated = await json<Conversation>(
      await h.request(`/api/conversations/${chat.id}`, {
        json: { pinned: true, title: "Better plans" },
        method: "PATCH",
      })
    );
    expect(updated).toMatchObject({ pinned: true, title: "Better plans" });

    const participants = await json<Participant[]>(
      await h.request(`/api/conversations/${chat.id}/participants`)
    );
    expect(participants).toMatchObject([
      { permission: "owner", user: { id: h.ownerId } },
    ]);

    const deleted = await h.request(`/api/conversations/${chat.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect((await h.request(`/api/conversations/${chat.id}`)).status).toBe(404);
  });

  it("refuses a context the caller isn't a member of", async () => {
    const { chat } = await answered();
    const other = await seedUser(h.db);
    const moved = await h.request(`/api/conversations/${chat.id}/context`, {
      json: { context: { id: other.id, type: "org" } },
      method: "PUT",
    });
    // Not a member of that org: refused before the lock is even checked.
    expect(moved.status).toBe(422);
  });

  it("hides a chat from someone without a grant", async () => {
    const { chat, run } = await answered();
    const stranger = await seedUser(h.db);
    for (const path of [
      `/api/conversations/${chat.id}`,
      `/api/conversations/${chat.id}/path`,
      `/api/runs/${run.runId}`,
      `/api/runs/${run.runId}/stream`,
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of paths.
      expect((await h.request(path, { as: stranger.id })).status).toBe(404);
    }
  });

  it("forks a branch into a new conversation and keeps per-user state", async () => {
    const { chat } = await answered();
    const tree = await json<MessageTree>(
      await h.request(`/api/conversations/${chat.id}/tree`)
    );
    const leaf = tree.nodes.at(-1)?.id;
    const forked = await json<Conversation>(
      await h.request(`/api/conversations/${chat.id}/fork`, {
        json: { leafId: leaf },
        method: "POST",
      }),
      201
    );
    expect(forked.id).not.toBe(chat.id);
    const messages = await json<{ items: Message[] }>(
      await h.request(`/api/conversations/${forked.id}/messages`)
    );
    expect(messages.items.map((m) => m.role)).toEqual(["user", "assistant"]);

    const state = await json<ParticipantState>(
      await h.request(`/api/conversations/${chat.id}/participants/me`, {
        json: { activeLeafId: leaf },
        method: "PATCH",
      })
    );
    expect(state).toMatchObject({ activeLeafId: leaf, userId: h.ownerId });
  });
});

describe("messages", () => {
  it("reads and deletes a message with everything below it", async () => {
    const { chat, run } = await answered();
    const message = await json<Message>(
      await h.request(`/api/messages/${run.userMessageId}`)
    );
    expect(message.parts).toEqual([{ text: "Is this on?", type: "text" }]);

    const deleted = await h.request(`/api/messages/${run.userMessageId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    const tree = await json<MessageTree>(
      await h.request(`/api/conversations/${chat.id}/tree`)
    );
    expect(tree.nodes).toEqual([]);
  });

  it("won't delete under a run that is still writing", async () => {
    const { chat, run } = await answered();
    const runs = await json<{ items: Run[] }>(
      await h.request(`/api/conversations/${chat.id}/runs?active=false`)
    );
    expect(runs.items.map((r) => r.id)).toEqual([run.runId]);
    // Park a second turn behind nothing: it's running until the model ends.
    const { scriptedModel } = await import("../testing/harness");
    const scripted = scriptedModel();
    h.nextTurn({ model: scripted.model });
    await h.request("/api/runs", {
      json: {
        conversationId: chat.id,
        input: { type: "regenerate", userMessageId: run.userMessageId },
        target: { model: "test:model", type: "model" },
      },
      method: "POST",
    });
    const blocked = await h.request(`/api/messages/${run.userMessageId}`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
    scripted.end();
    await h.services.executor.idle();
  });
});

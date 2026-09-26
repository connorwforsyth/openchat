import { textStream } from "@workspace/ai/testing/mock-models";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Feedback } from "@workspace/contract/schemas/feedback";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { upsertGrant } from "@workspace/db/queries/grants";
import { seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHarness, type Harness, readEvents } from "../testing/harness";

// Thumbs feedback (D21) through the HTTP app.

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

/** A chat with one exchange; returns the conversation and both messages. */
const exchange = async () => {
  const conversation = await json<Conversation>(
    await h.request("/api/conversations", { json: {}, method: "POST" }),
    201
  );
  h.nextTurn({
    model: new MockLanguageModelV4({ doStream: textStream("Hello!") }),
  });
  const created = await json<CreateRunOutput>(
    await h.request("/api/runs", {
      json: {
        conversationId: conversation.id,
        input: {
          parentId: null,
          parts: [{ text: "hi", type: "text" }],
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
  const path = await json<BranchPath>(
    await h.request(`/api/conversations/${conversation.id}/path`)
  );
  const [question, answer] = path.messages;
  if (!(question && answer)) {
    throw new Error("no exchange");
  }
  return { answer, conversation, question };
};

const feedbackUrl = (messageId: string) =>
  `/api/messages/${messageId}/feedback`;

describe("feedback procedures", () => {
  it("sets, replaces, reads and removes the caller's rating", async () => {
    const { answer } = await exchange();
    const url = feedbackUrl(answer.id);
    expect(await json(await h.request(url))).toBeNull();

    const first = await json<Feedback>(
      await h.request(url, { json: { rating: "down" }, method: "PUT" })
    );
    expect(first).toMatchObject({
      comment: null,
      messageId: answer.id,
      rating: "down",
      shareWithMaintainers: false,
      userId: h.ownerId,
    });

    const second = await json<Feedback>(
      await h.request(url, {
        json: {
          comment: "  Exactly what I needed.  ",
          rating: "up",
          shareWithMaintainers: true,
        },
        method: "PUT",
      })
    );
    expect(second).toMatchObject({
      comment: "Exactly what I needed.",
      id: first.id,
      rating: "up",
      shareWithMaintainers: true,
    });
    expect(await json(await h.request(url))).toEqual(second);

    const removed = await h.request(url, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(await json(await h.request(url))).toBeNull();
  });

  it("rates answers only", async () => {
    const { question } = await exchange();
    const response = await h.request(feedbackUrl(question.id), {
      json: { rating: "up" },
      method: "PUT",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("hides messages the caller can't read, and keeps ratings per person", async () => {
    const { answer, conversation } = await exchange();
    const url = feedbackUrl(answer.id);
    const reader = await seedUser(h.db);
    const outsider = await seedUser(h.db);

    const blocked = await h.request(url, {
      as: outsider.id,
      json: { rating: "down" },
      method: "PUT",
    });
    expect(blocked.status).toBe(404);

    await upsertGrant(h.db, {
      grantedBy: h.ownerId,
      permission: "viewer",
      principal: { id: reader.id, type: "user" },
      resource: { resourceId: conversation.id, resourceType: "conversation" },
    });
    await json(
      await h.request(url, {
        as: reader.id,
        json: { rating: "down" },
        method: "PUT",
      })
    );
    await json(await h.request(url, { json: { rating: "up" }, method: "PUT" }));
    expect(
      await json<Feedback>(await h.request(url, { as: reader.id }))
    ).toMatchObject({ rating: "down", userId: reader.id });
    expect(await json<Feedback>(await h.request(url))).toMatchObject({
      rating: "up",
      userId: h.ownerId,
    });
  });
});

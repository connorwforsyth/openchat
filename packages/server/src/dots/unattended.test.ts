import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Schedule } from "@workspace/contract/schemas/schedules";
import { seedOrg, seedUser } from "@workspace/db/testing";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";

// Only the server may start a run with nobody watching. A client that sends
// a run the engine's own idempotency key must not get the unattended policy,
// least of all another owner's auto-approved tools.

let h: Harness;
let request: Harness["request"];

beforeEach(async () => {
  h = await createHarness();
  const app = createApp({
    resolveSession: (req) => {
      const userId = req.headers.get(USER_HEADER);
      return Promise.resolve(userId ? { userId: userId as never } : null);
    },
    routers: createDotsRouter(h.services.dots),
    services: h.services,
  });
  request = async (path, { as, json: body, ...init } = {}) =>
    await app.request(path, {
      ...init,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        [USER_HEADER]: as ?? h.ownerId,
      },
    });
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

const callThenAnswer = (name: string) => {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      call += 1;
      return Promise.resolve(
        call === 1 ? toolCallStream(name, {}) : textStream("Done.")
      );
    },
  });
};

describe("unattended mode", () => {
  it("refuses a client's dot: key, so another owner's auto-approved tools still ask", async () => {
    const chat = await json<Conversation>(
      await request("/api/conversations", {
        json: { title: "Deploys" },
        method: "POST",
      }),
      201
    );
    const schedule = await json<Schedule>(
      await request("/api/schedules", {
        json: {
          autoApproveTools: ["deploy"],
          prompt: "Deploy the release.",
          readOnly: false,
          recurrence: {
            kind: "rrule",
            rrule: "FREQ=DAILY",
            startAt: "2026-10-20T08:00:00.000Z",
            timezone: "UTC",
          },
          target: { conversationId: chat.id, kind: "conversation" },
          title: "Nightly deploy",
        },
        method: "POST",
      }),
      201
    );

    const attacker = await seedUser(h.db);
    await seedOrg(h.db, attacker.id, { isPersonal: true });
    const theirs = await json<Conversation>(
      await request("/api/conversations", {
        as: attacker.id,
        json: { title: "Mine" },
        method: "POST",
      }),
      201
    );
    const deploy = vi.fn(() => "deployed");
    h.nextTurn({
      model: callThenAnswer("deploy"),
      toolApproval: { deploy: "user-approval" },
      tools: { deploy: tool({ execute: deploy, inputSchema: z.object({}) }) },
    });
    const sent = await request("/api/runs", {
      as: attacker.id,
      json: {
        conversationId: theirs.id,
        idempotencyKey: `dot:s:${schedule.id}:2026-10-20T09:00:00.000Z`,
        input: {
          parentId: null,
          parts: [{ text: "Go.", type: "text" }],
          type: "message",
        },
      },
      method: "POST",
    });
    await h.services.executor.idle();

    expect(deploy).not.toHaveBeenCalled();
    expect(sent.status).toBe(422);
    expect(await sent.json()).toMatchObject({
      data: { issues: [{ path: ["idempotencyKey"] }] },
    });
  });
});

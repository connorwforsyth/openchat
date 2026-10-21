import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { RunId, UserId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Dot } from "@workspace/contract/schemas/dots";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import type { Schedule } from "@workspace/contract/schemas/schedules";
import { type RunUnattended, run } from "@workspace/db/schema/chat";
import { seedOrg, seedUser } from "@workspace/db/testing";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";
import { dbDotPolicy } from "./turn";

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

const newChat = async (as?: UserId) =>
  json<Conversation>(
    await request("/api/conversations", {
      as,
      json: { title: "Deploys" },
      method: "POST",
    }),
    201
  );

const deploySchedule = async (chatId: string) =>
  json<Schedule>(
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
        target: { conversationId: chatId, kind: "conversation" },
        title: "Nightly deploy",
      },
      method: "POST",
    }),
    201
  );

const newAttacker = async () => {
  const attacker = await seedUser(h.db);
  await seedOrg(h.db, attacker.id, { isPersonal: true });
  return attacker.id;
};

const personTurn = async (chatId: string, as?: UserId) => {
  h.nextTurn({
    model: new MockLanguageModelV4({ doStream: textStream("Hi.") }),
  });
  const started = await json<CreateRunOutput>(
    await request("/api/runs", {
      as,
      json: {
        conversationId: chatId,
        input: {
          parentId: null,
          parts: [{ text: "Hello.", type: "text" }],
          type: "message",
        },
      },
      method: "POST",
    }),
    202
  );
  await h.services.executor.idle();
  return started.runId;
};

const lookup = () =>
  dbDotPolicy({
    access: h.services.access,
    db: h.db,
    limits: h.services.dots.limits,
  });

/** The turn policy of `runId` once the server has marked it unattended. */
const startedBy = async (runId: RunId, unattended: RunUnattended) => {
  await h.db.update(run).set({ unattended }).where(eq(run.id, runId));
  return await lookup()(runId);
};

describe("unattended mode", () => {
  it("refuses a client's dot: idempotency key", async () => {
    const schedule = await deploySchedule((await newChat()).id);
    const attacker = await newAttacker();
    const theirs = await newChat(attacker);
    const deploy = vi.fn(() => "deployed");
    h.nextTurn({
      model: callThenAnswer("deploy"),
      toolApproval: { deploy: "user-approval" },
      tools: { deploy: tool({ execute: deploy, inputSchema: z.object({}) }) },
    });
    const sent = await request("/api/runs", {
      as: attacker,
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

  it("reads a run's schedule only when the run's creator owns it", async () => {
    const mine = await newChat();
    const schedule = await deploySchedule(mine.id);
    const attacker = await newAttacker();
    const started = { scheduleId: schedule.id, type: "schedule" } as const;

    expect(
      await startedBy(
        await personTurn((await newChat(attacker)).id, attacker),
        started
      )
    ).toMatchObject({
      policy: { autoApproveTools: [], run: { readOnly: true } },
      type: "chat",
    });
    expect(await startedBy(await personTurn(mine.id), started)).toMatchObject({
      policy: {
        autoApproveTools: ["deploy"],
        run: { readOnly: false },
        title: "Nightly deploy",
      },
      type: "chat",
    });
  });

  it("ignores the idempotency key: only the server's mark is unattended", async () => {
    const schedule = await deploySchedule((await newChat()).id);
    const attacker = await newAttacker();
    const runId = await personTurn((await newChat(attacker)).id, attacker);
    await h.db
      .update(run)
      .set({ idempotencyKey: `dot:s:${schedule.id}:2026-10-20T09:00:00.000Z` })
      .where(eq(run.id, runId));

    expect(await lookup()(runId)).toBeNull();
  });

  it("gives a Dot's persona and approvals only to its owner's runs", async () => {
    const dot = await json<Dot>(
      await request("/api/dots", {
        json: {
          autoApproveTools: ["deploy"],
          name: "Pip",
          target: { model: "test:model", type: "model" },
        },
        method: "POST",
      }),
      201
    );
    const attacker = await newAttacker();
    const theirs = await personTurn((await newChat(attacker)).id, attacker);
    // As if the owner had shared the Dot's chat with them.
    await h.db
      .update(run)
      .set({ conversationId: dot.conversationId })
      .where(eq(run.id, theirs));

    expect(await startedBy(theirs, { type: "check_in" })).toMatchObject({
      policy: { autoApproveTools: [] },
      type: "chat",
    });
    expect(
      await startedBy(await personTurn(dot.conversationId), {
        type: "check_in",
      })
    ).toMatchObject({ policy: { autoApproveTools: ["deploy"] }, type: "dot" });
  });
});

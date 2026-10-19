import {
  MANAGE_SCHEDULES_TOOL,
  SCHEDULE_TASK_TOOL,
} from "@workspace/ai/schedules/tool";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { Dot } from "@workspace/contract/schemas/dots";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";
import { UNATTENDED_REFUSAL } from "./policy";

// A Dot's identity, activity and self-scheduling (172), end to end in
// process: Hono's `app.request`, the real executor on a mock model, PGlite.

let h: Harness;
let request: Harness["request"];
let clock: Date;

beforeEach(async () => {
  h = await createHarness();
  clock = new Date();
  const services = {
    ...h.services,
    dots: { ...h.services.dots, now: () => clock },
  };
  const app = createApp({
    resolveSession: (req) => {
      const userId = req.headers.get(USER_HEADER);
      return Promise.resolve(userId ? { userId: userId as never } : null);
    },
    routers: createDotsRouter(services.dots),
    services,
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

const MORNING = {
  instructions: "Be brief.",
  name: "Morning brief",
  schedules: [{ cron: "* * * * *", prompt: "List /work and report." }],
  target: { model: "test:model", type: "model" },
};

const createDot = async (body: unknown = MORNING) =>
  json<Dot>(await request("/api/dots", { json: body, method: "POST" }), 201);

const listDots = async () => json<Dot[]>(await request("/api/dots"));

const pathOf = async (conversationId: string) =>
  json<BranchPath>(await request(`/api/conversations/${conversationId}/path`));

const getRun = async (id: string) =>
  json<Run>(await request(`/api/runs/${id}`));

const BUDDY = {
  instructions: "Keep me on top of my inbox.",
  name: "Pip",
  target: { model: "test:model", type: "model" },
};

/** A model that calls one tool, then answers. */
const callThenAnswer = (name: string, input: unknown) => {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      call += 1;
      return Promise.resolve(
        call === 1 ? toolCallStream(name, input) : textStream("Done.")
      );
    },
  });
};

const runNow = async (id: string) => {
  const started = await json<CreateRunOutput>(
    await request(`/api/dots/${id}/run`, { json: {}, method: "POST" }),
    202
  );
  await h.services.executor.idle();
  return started;
};

describe("Dot identity", () => {
  it("is the owner's one, pinned Dot with a handle from its name", async () => {
    const dot = await createDot(BUDDY);
    expect(dot).toMatchObject({
      attention: false,
      avatar: { color: "sea", style: "orb" },
      handle: "pip",
      primary: true,
      rules: "",
      unreadRuns: 0,
    });
    const renamed = await json<Dot>(
      await request(`/api/dots/${dot.id}`, {
        json: { avatar: { color: "ember", style: "blob" }, handle: "pip-bot" },
        method: "PATCH",
      })
    );
    expect(renamed).toMatchObject({
      avatar: { color: "ember", style: "blob" },
      handle: "pip-bot",
      primary: true,
    });
    const second = await request("/api/dots", {
      json: BUDDY,
      method: "POST",
    });
    expect(second.status).toBe(409);
  });
});

describe("Dot activity", () => {
  it("lists the runs it started and counts the unread ones", async () => {
    const dot = await createDot(BUDDY);
    for (const text of ["One.", "Two."]) {
      h.nextTurn({
        model: new MockLanguageModelV4({ doStream: textStream(text) }),
      });
      // biome-ignore lint/performance/noAwaitInLoops: one run at a time, like the Dot.
      await runNow(dot.id);
    }
    const activity = await json<Dot["lastRun"][]>(
      await request(`/api/dots/${dot.id}/activity`)
    );
    expect(activity.map((run) => [run?.trigger, run?.snippet])).toEqual([
      ["manual", "Two."],
      ["manual", "One."],
    ]);
    expect((await listDots())[0]?.unreadRuns).toBe(2);
    clock = new Date(Date.now() + 60_000);
    const read = await json<Dot>(
      await request(`/api/dots/${dot.id}/read`, { method: "POST" })
    );
    expect(read).toMatchObject({ unread: false, unreadRuns: 0 });
    expect(read.lastViewedAt).toBe(clock.toISOString());

    const stranger = await seedUser(h.db);
    const theirs = await request(`/api/dots/${dot.id}/activity`, {
      as: stranger.id,
    });
    expect(theirs.status).toBe(404);
  });
});

describe("Dot self-scheduling", () => {
  it("lists and pauses its own schedules without asking", async () => {
    const dot = await createDot({
      ...BUDDY,
      schedules: [{ cron: "0 8 * * *", prompt: "Brief me." }],
    });
    const scheduleId = dot.schedules[0]?.id;
    h.nextTurn({
      model: callThenAnswer(MANAGE_SCHEDULES_TOOL, {
        action: "pause",
        scheduleId,
      }),
    });
    const started = await runNow(dot.id);
    expect((await getRun(started.runId)).state.status).toBe("succeeded");
    expect((await listDots())[0]?.schedules[0]).toMatchObject({
      nextRunAt: null,
      status: "paused",
    });
  });

  it("refuses schedule_task on an unattended run unless the Dot allows it", async () => {
    const dot = await createDot(BUDDY);
    const weekly = {
      prompt: "Weekly review of my inbox.",
      timezone: "Europe/London",
      title: "Weekly review",
      when: "every monday at 9am",
    };
    h.nextTurn({ model: callThenAnswer(SCHEDULE_TASK_TOOL, weekly) });
    await runNow(dot.id);
    expect((await listDots())[0]?.schedules).toEqual([]);
    const refused = (await pathOf(dot.conversationId)).messages.at(-1);
    expect(JSON.stringify(refused?.parts)).toContain(
      UNATTENDED_REFUSAL.slice(0, 40)
    );

    await request(`/api/dots/${dot.id}`, {
      json: { autoApproveTools: [SCHEDULE_TASK_TOOL] },
      method: "PATCH",
    });
    h.nextTurn({ model: callThenAnswer(SCHEDULE_TASK_TOOL, weekly) });
    await runNow(dot.id);
    expect((await listDots())[0]?.schedules).toMatchObject([
      {
        recurrence: {
          kind: "rrule",
          rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
          timezone: "Europe/London",
        },
        status: "active",
        target: { kind: "dot" },
        title: "Weekly review",
      },
    ]);
  });
});

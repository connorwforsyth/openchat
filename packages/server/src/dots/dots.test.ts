import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { Dot, DotSchedule } from "@workspace/contract/schemas/dots";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { seedUser } from "@workspace/db/testing";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";
import { dotJobHandlers } from "./jobs";
import { UNATTENDED_REFUSAL } from "./policy";

// Dots end to end, in process (172): the `dots` procedures through Hono's
// `app.request`, the tick and run jobs on the in-memory queue, the real
// executor on a mock model, and PGlite underneath.

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

/** Runs the tick, then the `dot.run` jobs it enqueued, then the runs. */
const tick = async () => {
  await dotJobHandlers({
    ...h.services.dots,
    now: () => clock,
    queue: h.jobs,
  })["dot.tick"]?.(
    {
      completedAt: null,
      createdAt: clock.toISOString(),
      data: {},
      id: "0199f000-0000-7000-8000-000000000001" as never,
      name: "dot.tick",
      output: null,
      retryCount: 0,
      singletonKey: null,
      startAfter: clock.toISOString(),
      state: "active",
    },
    new AbortController().signal
  );
  await h.jobs.drain();
  await h.services.executor.idle();
};

describe("dots API", () => {
  it("creates a Dot with its conversation and next run, owner-only", async () => {
    const dot = await createDot();
    expect(dot).toMatchObject({
      enabled: true,
      lastRun: null,
      name: "Morning brief",
      status: "idle",
      unread: false,
    });
    expect(dot.schedules).toHaveLength(1);
    const next = dot.schedules[0]?.nextRunAt ?? "";
    expect(new Date(next).getTime()).toBeGreaterThan(clock.getTime());
    expect(dot.nextRunAt).toBe(next);
    const chat = await json<{ title: string }>(
      await request(`/api/conversations/${dot.conversationId}`)
    );
    expect(chat.title).toBe("Morning brief");

    const stranger = await seedUser(h.db);
    const theirs = await request(`/api/dots/${dot.id}`, { as: stranger.id });
    expect(theirs.status).toBe(404);
    expect(
      await json<Dot[]>(await request("/api/dots", { as: stranger.id }))
    ).toEqual([]);
  });

  it("rejects a bad cron or zone with VALIDATION at its path", async () => {
    const bad = await request("/api/dots", {
      json: {
        ...MORNING,
        schedules: [{ cron: "every morning", prompt: "hi" }],
      },
      method: "POST",
    });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({
      data: { issues: [{ path: ["schedules", 0, "cron"] }] },
    });
    const dot = await createDot();
    const zone = await request(`/api/dots/${dot.id}/schedules`, {
      json: { cron: "0 8 * * *", prompt: "hi", timezone: "Nowhere/Land" },
      method: "POST",
    });
    expect(zone.status).toBe(422);
  });

  it("edits, pauses and deletes schedules, and deletes the Dot", async () => {
    const dot = await createDot();
    const added = await json<DotSchedule>(
      await request(`/api/dots/${dot.id}/schedules`, {
        json: { cron: "0 9 * * 1-5", prompt: "Weekday check", timezone: "UTC" },
        method: "POST",
      }),
      201
    );
    const paused = await json<DotSchedule>(
      await request(`/api/dot-schedules/${added.id}`, {
        json: { enabled: false },
        method: "PATCH",
      })
    );
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null });
    const removed = await request(`/api/dot-schedules/${added.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    const renamed = await json<Dot>(
      await request(`/api/dots/${dot.id}`, {
        json: { name: "Evening brief" },
        method: "PATCH",
      })
    );
    expect(renamed.name).toBe("Evening brief");
    expect(renamed.schedules).toHaveLength(1);
    expect(
      (await request(`/api/dots/${dot.id}`, { method: "DELETE" })).status
    ).toBe(204);
    expect(await listDots()).toEqual([]);
  });
});

describe("scheduled runs", () => {
  it("fires a due schedule into the Dot's conversation, then shows unread", async () => {
    const dot = await createDot();
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: textStream("Good morning: 3 files in /work."),
      }),
    });
    // Nothing is due yet.
    await tick();
    expect((await listDots())[0]?.lastRun).toBeNull();

    clock = new Date(clock.getTime() + 61_000);
    await tick();

    const [after] = await listDots();
    expect(after).toMatchObject({
      lastRun: {
        snippet: "Good morning: 3 files in /work.",
        status: "succeeded",
        trigger: "schedule",
      },
      status: "idle",
      unread: true,
    });
    expect(after?.schedules[0]?.lastStatus).toBe("succeeded");
    expect(
      new Date(after?.schedules[0]?.nextRunAt ?? 0).getTime()
    ).toBeGreaterThan(clock.getTime());
    const path = await pathOf(dot.conversationId);
    expect(path.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(path.messages[0]?.parts).toEqual([
      { text: "List /work and report.", type: "text" },
    ]);

    // The same occurrence never fires twice; opening the Dot clears unread.
    await tick();
    expect((await pathOf(dot.conversationId)).messages).toHaveLength(2);
    clock = new Date(clock.getTime() + 1000);
    const read = await json<Dot>(
      await request(`/api/dots/${dot.id}/read`, { method: "POST" })
    );
    expect(read.unread).toBe(false);
  });

  it("doesn't fire a paused Dot", async () => {
    const dot = await createDot();
    await request(`/api/dots/${dot.id}`, {
      json: { enabled: false },
      method: "PATCH",
    });
    clock = new Date(clock.getTime() + 120_000);
    await tick();
    expect((await pathOf(dot.conversationId)).messages).toHaveLength(0);
  });

  it("refuses an ask tool instead of waiting, unless the Dot allows it", async () => {
    const execute = vi.fn(() => "wrote it");
    const tools = {
      write: tool({ execute, inputSchema: z.object({ path: z.string() }) }),
    };
    const twoSteps = () => {
      let call = 0;
      return new MockLanguageModelV4({
        doStream: () => {
          call += 1;
          return Promise.resolve(
            call === 1
              ? toolCallStream("write", { path: "a.txt" })
              : textStream("Report done.")
          );
        },
      });
    };
    const dot = await createDot();
    h.nextTurn({
      model: twoSteps(),
      toolApproval: { write: "user-approval" },
      tools,
    });
    const started = await json<CreateRunOutput>(
      await request(`/api/dots/${dot.id}/run`, { json: {}, method: "POST" }),
      202
    );
    await h.services.executor.idle();
    const run = await getRun(started.runId);
    expect(run.state.status).toBe("succeeded");
    expect(execute).not.toHaveBeenCalled();
    const answer = (await pathOf(dot.conversationId)).messages.at(-1);
    expect(JSON.stringify(answer?.parts)).toContain(
      UNATTENDED_REFUSAL.slice(0, 40)
    );

    // Allowed by name, the same call runs without asking.
    await request(`/api/dots/${dot.id}`, {
      json: { autoApproveTools: ["write"] },
      method: "PATCH",
    });
    h.nextTurn({
      model: twoSteps(),
      toolApproval: { write: "user-approval" },
      tools,
    });
    const again = await json<CreateRunOutput>(
      await request(`/api/dots/${dot.id}/run`, { json: {}, method: "POST" }),
      202
    );
    await h.services.executor.idle();
    expect((await getRun(again.runId)).state.status).toBe("succeeded");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("pauses a schedule after three failed runs in a row", async () => {
    const dot = await createDot();
    for (const _ of [1, 2, 3]) {
      h.nextTurn({
        model: new MockLanguageModelV4({
          doStream: () => Promise.reject(new Error("provider down")),
        }),
      });
      clock = new Date(clock.getTime() + 61_000);
      // biome-ignore lint/performance/noAwaitInLoops: each tick must settle before the next fires.
      await tick();
    }
    const [after] = await listDots();
    expect(after?.status).toBe("failed");
    expect(after?.schedules[0]).toMatchObject({
      enabled: false,
      lastStatus: "failed",
      nextRunAt: null,
    });
    expect(dot.id).toBe(after?.id);
  });
});

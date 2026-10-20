import { REPORT_TOOL } from "@workspace/ai/schedules/tool";
import {
  textStream,
  toolCallStream,
  usage,
} from "@workspace/ai/testing/mock-models";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Dot } from "@workspace/contract/schemas/dots";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import type {
  Schedule,
  ScheduleLimits,
  ScheduleRun,
} from "@workspace/contract/schemas/schedules";
import { seedUser } from "@workspace/db/testing";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import { registerJobs } from "../jobs/registry";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";
import { dotJobHandlers } from "./jobs";

// Schedules end to end, in process (173, 175): the `schedules` procedures
// through Hono's `app.request`, the tick and run jobs on the in-memory
// queue, the real executor on mock models (never a provider), PGlite below.

let h: Harness;
let request: Harness["request"];
let clock: Date;
let services: Harness["services"];

const withDots = async (patch: Partial<Harness["services"]["dots"]>) => {
  services = { ...services, dots: { ...services.dots, ...patch } };
  await registerJobs(
    h.jobs,
    dotJobHandlers({ ...services.dots, queue: h.jobs })
  );
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
};

beforeEach(async () => {
  h = await createHarness();
  clock = new Date("2026-10-20T08:58:00.000Z");
  ({ services } = h);
  await withDots({ now: () => clock });
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

const newChat = async () =>
  json<Conversation>(
    await request("/api/conversations", {
      json: { title: "Release notes" },
      method: "POST",
    }),
    201
  );

const HOURLY = {
  kind: "rrule",
  rrule: "FREQ=HOURLY",
  startAt: "2026-10-20T08:00:00.000Z",
  timezone: "UTC",
} as const;

const create = async (body: Record<string, unknown>, status = 201) =>
  json<Schedule>(
    await request("/api/schedules", {
      json: {
        prompt: "Anything new on the release?",
        recurrence: HOURLY,
        title: "Release watch",
        ...body,
      },
      method: "POST",
    }),
    status
  );

const runsOf = async (id: string) =>
  json<ScheduleRun[]>(await request(`/api/schedules/${id}/runs`));

const pathOf = async (conversationId: string) =>
  json<BranchPath>(await request(`/api/conversations/${conversationId}/path`));

const getRun = async (id: string) =>
  json<Run>(await request(`/api/runs/${id}`));

const jobOf = <T>(name: string, data: T) => ({
  completedAt: null,
  createdAt: clock.toISOString(),
  data,
  id: "0199f000-0000-7000-8000-000000000001" as never,
  name,
  output: null,
  retryCount: 0,
  singletonKey: null,
  startAfter: clock.toISOString(),
  state: "active" as const,
});

const claimDue = async () => {
  await dotJobHandlers({ ...services.dots, queue: h.jobs })["dot.tick"]?.(
    jobOf("dot.tick", {}),
    new AbortController().signal
  );
};

/** Runs the tick, then the `dot.run` jobs it enqueued, then the runs. */
const tick = async () => {
  await claimDue();
  await h.jobs.drain();
  await h.services.executor.idle();
};

const limitsNow = async () =>
  json<ScheduleLimits>(await request("/api/schedule-limits"));

const ONCE_0930 = {
  ...HOURLY,
  rrule: "FREQ=DAILY;COUNT=1",
  startAt: "2026-10-20T09:30:00.000Z",
} as const;

/** A model that reports `outcome` in one step, counting its calls. */
const reporting = (
  outcome: "update" | "no_update" | "needs_attention",
  reply = "The release is out."
) => {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doStream: () => {
      calls += 1;
      return Promise.resolve(
        calls > 1
          ? textStream("Should never be asked again.")
          : toolCallStream(
              REPORT_TOOL,
              outcome === "no_update"
                ? { outcome }
                : { outcome, summary: reply }
            )
      );
    },
  });
  return { calls: () => calls, model };
};

describe("schedules API", () => {
  it("targets an ordinary chat, read-only, and shows on the chat", async () => {
    const chat = await newChat();
    const schedule = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    expect(schedule).toMatchObject({
      conversationId: chat.id,
      nextRunNominalAt: "2026-10-20T09:00:00.000Z",
      notify: "important",
      readOnly: true,
      status: "active",
      target: { kind: "conversation" },
    });
    // The jittered fire time stays within five minutes of the true time.
    const offset =
      new Date(schedule.nextRunAt ?? 0).getTime() -
      new Date("2026-10-20T09:00:00.000Z").getTime();
    expect(Math.abs(offset)).toBeLessThanOrEqual(300_000);

    const listed = await json<{ items: Conversation[] }>(
      await request("/api/conversations")
    );
    expect(listed.items.find((each) => each.id === chat.id)?.schedule).toEqual({
      id: schedule.id,
      nextRunNominalAt: "2026-10-20T09:00:00.000Z",
      status: "active",
      title: "Release watch",
    });

    const stranger = await seedUser(h.db);
    const theirs = await request(`/api/schedules/${schedule.id}`, {
      as: stranger.id,
    });
    expect(theirs.status).toBe(404);
    const intoMine = await request("/api/schedules", {
      as: stranger.id,
      json: {
        prompt: "x",
        recurrence: HOURLY,
        target: { conversationId: chat.id, kind: "conversation" },
        title: "x",
      },
      method: "POST",
    });
    expect(intoMine.status).toBe(404);
  });

  it("refuses intervals below the minimum and one-offs in the past", async () => {
    const tooOften = await request("/api/schedules", {
      json: {
        prompt: "x",
        recurrence: { ...HOURLY, rrule: "FREQ=MINUTELY;INTERVAL=10" },
        target: { kind: "new_chat_each_run" },
        title: "x",
      },
      method: "POST",
    });
    expect(tooOften.status).toBe(422);
    expect(await tooOften.json()).toMatchObject({
      data: { issues: [{ path: ["recurrence"] }] },
    });
    const past = await request("/api/schedules", {
      json: {
        prompt: "x",
        recurrence: {
          ...HOURLY,
          rrule: "FREQ=DAILY;COUNT=1",
          startAt: "2026-10-19T08:00:00.000Z",
        },
        target: { kind: "new_chat_each_run" },
        title: "x",
      },
      method: "POST",
    });
    expect(past.status).toBe(422);
  });

  it("pauses when its chat is archived, and won't resume until it's back", async () => {
    const chat = await newChat();
    const schedule = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    await request(`/api/conversations/${chat.id}`, {
      json: { archived: true },
      method: "PATCH",
    });
    expect(
      await json<Schedule>(await request(`/api/schedules/${schedule.id}`))
    ).toMatchObject({ pausedReason: "target_archived", status: "paused" });
    const resumed = await request(`/api/schedules/${schedule.id}/resume`, {
      method: "POST",
    });
    expect(resumed.status).toBe(409);
    const added = await request("/api/schedules", {
      json: {
        prompt: "x",
        recurrence: HOURLY,
        target: { conversationId: chat.id, kind: "conversation" },
        title: "x",
      },
      method: "POST",
    });
    expect(added.status).toBe(409);

    await request(`/api/conversations/${chat.id}`, {
      json: { archived: false },
      method: "PATCH",
    });
    const again = await json<Schedule>(
      await request(`/api/schedules/${schedule.id}/resume`, { method: "POST" })
    );
    expect(again).toMatchObject({ pausedReason: null, status: "active" });
  });

  it("won't put a schedule on the Dot's chat while it's archived", async () => {
    const dot = await json<Dot>(
      await request("/api/dots", {
        json: { name: "Pip", target: { model: "test:model", type: "model" } },
        method: "POST",
      }),
      201
    );
    const schedule = await create({ target: { kind: "dot" } });
    await request(`/api/conversations/${dot.conversationId}`, {
      json: { archived: true },
      method: "PATCH",
    });
    expect(
      await json<Schedule>(await request(`/api/schedules/${schedule.id}`))
    ).toMatchObject({ pausedReason: "target_archived", status: "paused" });

    const resumed = await request(`/api/schedules/${schedule.id}/resume`, {
      method: "POST",
    });
    expect(resumed.status).toBe(409);
    const added = await request("/api/schedules", {
      json: {
        prompt: "x",
        recurrence: HOURLY,
        target: { kind: "dot" },
        title: "x",
      },
      method: "POST",
    });
    expect(added.status).toBe(409);
  });

  it("won't revive a finished one-off onto an archived chat", async () => {
    const chat = await newChat();
    const once = await create({
      recurrence: ONCE_0930,
      target: { conversationId: chat.id, kind: "conversation" },
    });
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:31:00.000Z");
    await tick();
    await request(`/api/conversations/${chat.id}`, {
      json: { archived: true },
      method: "PATCH",
    });

    const edited = await request(`/api/schedules/${once.id}`, {
      json: {
        recurrence: { ...ONCE_0930, startAt: "2026-10-20T12:00:00.000Z" },
      },
      method: "PATCH",
    });
    expect(edited.status).toBe(409);
  });

  it("reports the guardrails and today's usage", async () => {
    const limits = await json<ScheduleLimits>(
      await request("/api/schedule-limits")
    );
    expect(limits).toMatchObject({
      maxRunsPerDay: 24,
      minIntervalMinutes: 60,
      runStepBudget: 8,
      runsToday: 0,
      runTokenBudget: 20_000,
    });
  });
});

describe("scheduled runs", () => {
  it("posts into the chat as the scheduled task, withholding write tools", async () => {
    const chat = await newChat();
    const schedule = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    const write = vi.fn(() => "wrote");
    const read = vi.fn(() => "notes");
    const { model } = reporting("update");
    h.nextTurn({
      model,
      tools: {
        read: tool({ execute: read, inputSchema: z.object({}) }),
        write: tool({ execute: write, inputSchema: z.object({}) }),
      },
    });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();

    const path = await pathOf(chat.id);
    expect(path.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(path.messages[0]?.parts[0]).toEqual({
      data: { scheduleId: schedule.id, title: "Release watch" },
      name: "scheduled-task",
      type: "data",
    });
    const [run] = await runsOf(schedule.id);
    expect(run).toMatchObject({
      // `important` tells the owner only when they should act.
      notified: false,
      outcome: "update",
      status: "succeeded",
      summary: "The release is out.",
      trigger: "scheduled",
    });
    const turn = await getRun(run?.runId ?? "");
    expect(turn.state.status).toBe("succeeded");
    const after = await json<Schedule>(
      await request(`/api/schedules/${schedule.id}`)
    );
    expect(after).toMatchObject({
      lastOutcome: "update",
      nextRunNominalAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("ends a quiet run after one step and leaves the Dot unread-free", async () => {
    const dot = await json<Dot>(
      await request("/api/dots", {
        json: { name: "Pip", target: { model: "test:model", type: "model" } },
        method: "POST",
      }),
      201
    );
    const schedule = await create({ notify: "all", target: { kind: "dot" } });
    expect(schedule.readOnly).toBe(false);
    const quiet = reporting("no_update");
    h.nextTurn({ model: quiet.model });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();

    expect(quiet.calls()).toBe(1);
    const [run] = await runsOf(schedule.id);
    expect(run).toMatchObject({ notified: false, outcome: "no_update" });
    const [mine] = await json<Dot[]>(await request("/api/dots"));
    expect(mine).toMatchObject({
      attention: false,
      unread: false,
      unreadRuns: 0,
    });

    // An important finding does tell the owner, and asks for attention.
    const loud = reporting("needs_attention", "Your card was declined.");
    h.nextTurn({ model: loud.model });
    clock = new Date("2026-10-20T10:06:00.000Z");
    await tick();
    const [later] = await json<Dot[]>(await request("/api/dots"));
    expect(later).toMatchObject({
      attention: true,
      unread: true,
      unreadRuns: 1,
    });
    expect(dot.id).toBe(later?.id);
  });

  it("fails a run that goes over its token budget", async () => {
    const chat = await newChat();
    const schedule = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    const greedy = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve(
          streamWith(toolCallStream("read", {}), usage(15_000, 6000))
        ),
    });
    h.nextTurn({
      model: greedy,
      tools: { read: tool({ execute: () => "x", inputSchema: z.object({}) }) },
    });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();
    const [run] = await runsOf(schedule.id);
    expect(run).toMatchObject({ outcome: "failed", status: "failed" });
    expect(run?.error).toContain("token budget");
  });

  it("defers while the chat is busy, then skips the slot as busy", async () => {
    const chat = await newChat();
    const schedule = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    // Someone is mid-turn in the chat: a run waiting on approval.
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: () => Promise.resolve(toolCallStream("ask_me", {})),
      }),
      toolApproval: { ask_me: "user-approval" },
      tools: {
        ask_me: tool({ execute: () => "ok", inputSchema: z.object({}) }),
      },
    });
    const started = await json<CreateRunOutput>(
      await request("/api/runs", {
        json: {
          conversationId: chat.id,
          input: {
            parentId: null,
            parts: [{ text: "Hi", type: "text" }],
            type: "message",
          },
        },
        method: "POST",
      }),
      202
    );
    await h.services.executor.idle();
    expect((await getRun(started.runId)).state.status).toBe(
      "awaiting_approval"
    );

    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();
    expect(await runsOf(schedule.id)).toEqual([]);
    const deferred = await json<Schedule>(
      await request(`/api/schedules/${schedule.id}`)
    );
    expect(deferred.nextRunNominalAt).toBe("2026-10-20T09:00:00.000Z");
    expect(deferred.nextRunAt).toBe("2026-10-20T09:07:00.000Z");

    clock = new Date("2026-10-20T09:59:30.000Z");
    await tick();
    const [skipped] = await runsOf(schedule.id);
    expect(skipped).toMatchObject({
      notified: false,
      outcome: "skipped",
      runId: null,
      skipReason: "busy",
    });
  });

  it("skips slots once the daily cap is used, and refuses Run now", async () => {
    await withDots({
      limits: { ...services.dots.limits, maxRunsPerUserPerDay: 1 },
    });
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    h.nextTurn({ model: reporting("update").model });
    const now = await request(`/api/schedules/${schedule.id}/run`, {
      method: "POST",
    });
    expect(now.status).toBe(202);
    await h.services.executor.idle();
    const capped = await request(`/api/schedules/${schedule.id}/run`, {
      method: "POST",
    });
    expect(capped.status).toBe(429);

    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();
    const runs = await runsOf(schedule.id);
    expect(
      runs.map((run) => [run.trigger, run.outcome, run.skipReason])
    ).toEqual([
      ["scheduled", "skipped", "cap"],
      ["run_now", "update", null],
    ]);
  });

  it("counts a claimed slot toward the cap before its run starts", async () => {
    await withDots({
      limits: { ...services.dots.limits, maxRunsPerUserPerDay: 1 },
    });
    const due = await create({ target: { kind: "new_chat_each_run" } });
    const later = await create({
      recurrence: { ...HOURLY, startAt: "2026-10-21T08:00:00.000Z" },
      target: { kind: "new_chat_each_run" },
      title: "Later",
    });
    h.nextTurn({ model: reporting("update").model });
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await claimDue();

    const now = await request(`/api/schedules/${later.id}/run`, {
      method: "POST",
    });
    expect(now.status).toBe(429);
    await h.jobs.drain();
    await h.services.executor.idle();
    expect((await runsOf(due.id)).map((run) => run.outcome)).toEqual([
      "update",
    ]);
    expect((await limitsNow()).runsToday).toBe(1);
  });

  it("lets one of two Run nows through when one run is left", async () => {
    await withDots({
      limits: { ...services.dots.limits, maxRunsPerUserPerDay: 1 },
    });
    const first = await create({ target: { kind: "new_chat_each_run" } });
    const second = await create({
      target: { kind: "new_chat_each_run" },
      title: "Second",
    });
    h.nextTurn({ model: reporting("update").model });
    h.nextTurn({ model: reporting("update").model });
    const sent = await Promise.all(
      [first, second].map((schedule) =>
        request(`/api/schedules/${schedule.id}/run`, { method: "POST" })
      )
    );
    await h.services.executor.idle();
    expect(sent.map((response) => response.status).sort()).toEqual([202, 429]);
    expect((await limitsNow()).runsToday).toBe(1);
  });

  it("records a run that can't start, leaving no empty chat behind", async () => {
    await withDots({
      defaultModel: null,
      runs: { ...services.dots.runs, defaultModel: null },
    });
    const once = await create({
      recurrence: ONCE_0930,
      target: { kind: "new_chat_each_run" },
    });
    const chats = async () =>
      (
        await json<{ items: Conversation[] }>(
          await request("/api/conversations")
        )
      ).items;
    const before = await chats();
    clock = new Date("2026-10-20T09:31:00.000Z");
    await tick();

    expect(
      (await runsOf(once.id)).map((run) => [run.outcome, run.runId])
    ).toEqual([["failed", null]]);
    expect(await chats()).toEqual(before);
    expect((await limitsNow()).runsToday).toBe(0);
    expect(
      await json<Schedule>(await request(`/api/schedules/${once.id}`))
    ).toMatchObject({ lastOutcome: "failed", status: "completed" });
  });

  it("starts a new chat each run, titled with the task and date", async () => {
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();
    const [run] = await runsOf(schedule.id);
    const chat = await json<Conversation>(
      await request(`/api/conversations/${run?.conversationId}`)
    );
    expect(chat.title).toBe("Release watch · 20 Oct");
  });

  it("fires a one-off once and then reads completed", async () => {
    const schedule = await create({
      recurrence: {
        ...HOURLY,
        rrule: "FREQ=DAILY;COUNT=1",
        startAt: "2026-10-20T09:30:00.000Z",
      },
      target: { kind: "new_chat_each_run" },
    });
    expect(schedule.nextRunAt).toBe("2026-10-20T09:30:00.000Z");
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:31:00.000Z");
    await tick();
    const after = await json<Schedule>(
      await request(`/api/schedules/${schedule.id}`)
    );
    expect(after).toMatchObject({ nextRunAt: null, status: "completed" });
    expect(await runsOf(schedule.id)).toHaveLength(1);
    const resumed = await request(`/api/schedules/${schedule.id}/resume`, {
      method: "POST",
    });
    expect(resumed.status).toBe(409);
  });
});

/** A stream with its finish's usage replaced. */
const streamWith = (
  result: ReturnType<typeof toolCallStream>,
  tokens: ReturnType<typeof usage>
): ReturnType<typeof toolCallStream> => ({
  stream: result.stream.pipeThrough(
    new TransformStream({
      transform(part, controller) {
        controller.enqueue(
          part.type === "finish" ? { ...part, usage: tokens } : part
        );
      },
    })
  ),
});

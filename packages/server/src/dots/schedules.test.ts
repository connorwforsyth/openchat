import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import { MIGRATIONS_FOLDER } from "@workspace/db/migrator";
import { dotRun, dotSchedule } from "@workspace/db/schema/dots";
import { seedOrg, seedUser } from "@workspace/db/testing";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import { registerJobs } from "../jobs/registry";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";
import { dotJobHandlers } from "./jobs";
import { titleFromPrompt } from "./schedule-policy";

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
      emoji: "⏰",
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

  it("won't resume or run into a chat its owner can no longer reach", async () => {
    const chat = await newChat();
    const schedule = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    await request(`/api/schedules/${schedule.id}/pause`, { method: "POST" });
    const stranger = await seedUser(h.db);
    await seedOrg(h.db, stranger.id, { isPersonal: true });
    const theirs = await json<Conversation>(
      await request("/api/conversations", {
        as: stranger.id,
        json: { title: "Theirs" },
        method: "POST",
      }),
      201
    );
    const refusals = async () =>
      await Promise.all(
        ["resume", "run"].map(async (action) => {
          const response = await request(
            `/api/schedules/${schedule.id}/${action}`,
            { method: "POST" }
          );
          return [response.status, (await response.json()).data?.reason];
        })
      );

    for (const conversationId of [theirs.id, null]) {
      // biome-ignore lint/performance/noAwaitInLoops: each case reads the row the last one left.
      await h.db
        .update(dotSchedule)
        .set({ conversationId })
        .where(eq(dotSchedule.id, schedule.id));
      expect(await refusals()).toEqual([
        [409, "target_archived"],
        [409, "target_archived"],
      ]);
    }
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
    expect(await resumed.json()).toMatchObject({
      data: { reason: "target_archived" },
    });
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

  it("labels a task with the emoji it's given, or ⏰", async () => {
    const chat = await newChat();
    const target = { conversationId: chat.id, kind: "conversation" };
    expect((await create({ target })).emoji).toBe("⏰");
    const sunny = await create({ emoji: "☀️", target });
    expect(sunny.emoji).toBe("☀️");
    await create({ emoji: "sun", target }, 400);

    const changed = await json<Schedule>(
      await request(`/api/schedules/${sunny.id}`, {
        json: { emoji: "🔔" },
        method: "PATCH",
      })
    );
    expect(changed).toMatchObject({ emoji: "🔔", title: sunny.title });
  });

  it("gives schedules made before emoji labels ⏰", async () => {
    const chat = await newChat();
    await create({
      emoji: "☀️",
      target: { conversationId: chat.id, kind: "conversation" },
    });
    await h.db.execute(sql`alter table dot_schedule drop column emoji`);
    await h.db.execute(
      sql.raw(
        await readFile(
          join(
            MIGRATIONS_FOLDER,
            "20261022122628_schedule_emoji/migration.sql"
          ),
          "utf8"
        )
      )
    );
    const [only] = await json<Schedule[]>(await request("/api/schedules"));
    expect(only?.emoji).toBe("⏰");
  });

  it("retitles schedules the schedules migration cut mid-word", async () => {
    const chat = await newChat();
    const target = { conversationId: chat.id, kind: "conversation" };
    const cut = [
      "Give me a short brief for today: what's on, what changed overnight, and anything I should look at first.",
      "Every morning look through the team inbox and summarise anything from customers about billing",
      "Summarise the news, e.g. tech, markets and anything about our launch this week",
      "🚀".repeat(70),
    ];
    // Titled as the old migration titled them, and as someone could have:
    // a whole short prompt, or a name shorter than the prompt.
    const short = "Standup notes. Post them in the team channel";
    const named = {
      prompt:
        "Watch the deploy queue and tell me when it drains overnight please",
      title: "Watch the deploy queue",
    };
    for (const prompt of [...cut, short]) {
      // biome-ignore lint/performance/noAwaitInLoops: kept in order.
      await create({ prompt, target });
    }
    await create({ ...named, target });
    await h.db.execute(
      sql`update dot_schedule set title = left(regexp_replace(prompt, '\\s+', ' ', 'g'), 60) where prompt <> ${named.prompt}`
    );

    await h.db.execute(
      sql.raw(
        await readFile(
          join(
            MIGRATIONS_FOLDER,
            "20261020125719_schedule_titles/migration.sql"
          ),
          "utf8"
        )
      )
    );

    const listed = await json<Schedule[]>(await request("/api/schedules"));
    const titles = new Map(listed.map((each) => [each.prompt, each.title]));
    expect(titles.get(short)).toBe(short);
    expect(titles.get(named.prompt)).toBe(named.title);
    for (const prompt of cut) {
      expect(titles.get(prompt)).toBe(titleFromPrompt(prompt));
    }
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

  it("refuses Run now into an archived chat", async () => {
    const dot = await json<Dot>(
      await request("/api/dots", {
        json: { name: "Pip", target: { model: "test:model", type: "model" } },
        method: "POST",
      }),
      201
    );
    const chat = await newChat();
    const onChat = await create({
      target: { conversationId: chat.id, kind: "conversation" },
    });
    const onDot = await create({ target: { kind: "dot" }, title: "Dot" });
    for (const id of [chat.id, dot.conversationId]) {
      // biome-ignore lint/performance/noAwaitInLoops: two archives, in order.
      await request(`/api/conversations/${id}`, {
        json: { archived: true },
        method: "PATCH",
      });
    }

    const sent = [
      await request(`/api/schedules/${onChat.id}/run`, { method: "POST" }),
      await request(`/api/schedules/${onDot.id}/run`, { method: "POST" }),
      await request(`/api/dots/${dot.id}/run`, { json: {}, method: "POST" }),
    ];
    expect(sent.map((response) => response.status)).toEqual([409, 409, 409]);
    for (const response of sent) {
      // biome-ignore lint/performance/noAwaitInLoops: reading bodies already sent.
      expect(await response.json()).toMatchObject({
        data: { reason: "target_archived" },
      });
    }
    expect((await limitsNow()).runsToday).toBe(0);
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
      data: { emoji: "⏰", scheduleId: schedule.id, title: "Release watch" },
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
    const turn = await getRun(
      run && run.outcome !== "skipped" ? run.runId : ""
    );
    expect(turn.state.status).toBe("succeeded");
    const after = await json<Schedule>(
      await request(`/api/schedules/${schedule.id}`)
    );
    expect(after).toMatchObject({
      lastOutcome: "update",
      nextRunNominalAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("refuses a dot_run row that is neither a run nor a skipped slot", async () => {
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    await expect(
      h.db.insert(dotRun).values({
        ownerId: h.ownerId,
        scheduleId: schedule.id,
        skipReason: "busy",
        trigger: "schedule",
      })
    ).rejects.toThrow();
  });

  it("lists a schedule's history past a row from before the shape check", async () => {
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();
    await h.db.execute(sql`alter table dot_run drop constraint dot_run_shape`);
    await h.db.insert(dotRun).values({
      ownerId: h.ownerId,
      scheduleId: schedule.id,
      skipReason: "busy",
      trigger: "schedule",
    });

    expect((await runsOf(schedule.id)).map((run) => run.outcome)).toEqual([
      "update",
    ]);
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
    expect(run).toMatchObject({
      error: expect.stringContaining("token budget"),
      outcome: "failed",
      status: "failed",
    });
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
      skipReason: "busy",
    });
    expect(skipped).not.toHaveProperty("runId");
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
      runs.map((run) => [
        run.trigger,
        run.outcome,
        run.outcome === "skipped" ? run.skipReason : null,
      ])
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

  it("leaves no empty chat behind when a run can't start", async () => {
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

    expect(await chats()).toEqual(before);
    expect(await runsOf(once.id)).toEqual([]);
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
    expect(await resumed.json()).toMatchObject({
      data: { reason: "schedule_completed" },
    });
  });
});

describe("claims", () => {
  const chats = async () =>
    (await json<{ items: Conversation[] }>(await request("/api/conversations")))
      .items;

  it("gives a claim back when its schedule is paused before it starts", async () => {
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await claimDue();
    await request(`/api/schedules/${schedule.id}/pause`, { method: "POST" });
    await h.jobs.drain();

    expect(await runsOf(schedule.id)).toEqual([]);
    expect((await limitsNow()).runsToday).toBe(0);
  });

  it("gives back a claim no run ever started, and says the slot failed", async () => {
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await claimDue();
    expect((await limitsNow()).runsToday).toBe(1);

    clock = new Date("2026-10-20T09:22:00.000Z");
    await claimDue();
    await h.jobs.drain();
    expect(await runsOf(schedule.id)).toEqual([]);
    expect((await limitsNow()).runsToday).toBe(0);
    expect(
      await json<Schedule>(await request(`/api/schedules/${schedule.id}`))
    ).toMatchObject({ lastOutcome: "failed" });
  });

  it("cancels a run whose claim the tick gave back while it started", async () => {
    const { executor } = services.dots.runs;
    let started: string | null = null;
    await withDots({
      runs: {
        ...services.dots.runs,
        executor: {
          ...executor,
          start: async (run) => {
            started = run.runId;
            clock = new Date("2026-10-20T09:22:00.000Z");
            await claimDue();
            return executor.start(run);
          },
        },
      },
    });
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    h.nextTurn({ model: reporting("update").model });
    const before = await chats();
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();

    expect(started).not.toBeNull();
    expect(await runsOf(schedule.id)).toEqual([]);
    expect((await limitsNow()).runsToday).toBe(0);
    expect(await chats()).toEqual(before);
    expect(
      await json<Schedule>(await request(`/api/schedules/${schedule.id}`))
    ).toMatchObject({ lastOutcome: "failed" });
  });

  it("keeps a late job's claim when the tick sweeps while its run starts", async () => {
    const { executor } = services.dots.runs;
    await withDots({
      runs: {
        ...services.dots.runs,
        executor: {
          ...executor,
          start: async (run) => {
            clock = new Date("2026-10-20T09:22:00.000Z");
            await claimDue();
            return executor.start(run);
          },
        },
      },
    });
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await claimDue();
    // Its job runs 14 minutes after the claim, just inside the sweep's limit.
    clock = new Date("2026-10-20T09:20:00.000Z");
    await h.jobs.drain();
    await h.services.executor.idle();

    expect((await runsOf(schedule.id)).map((run) => run.outcome)).toEqual([
      "update",
    ]);
    expect((await limitsNow()).runsToday).toBe(1);
  });

  it("starts a retried claim's run once, in one chat", async () => {
    const schedule = await create({ target: { kind: "new_chat_each_run" } });
    h.nextTurn({ model: reporting("update").model });
    clock = new Date("2026-10-20T09:06:00.000Z");
    await tick();
    const [first] = await runsOf(schedule.id);
    if (!first || first.outcome === "skipped") {
      throw new Error("the slot didn't run");
    }
    const before = await chats();
    const retry = () =>
      dotJobHandlers({ ...services.dots, queue: h.jobs })["dot.run"]?.(
        jobOf("dot.run", { claimId: first.id }),
        new AbortController().signal
      );

    await retry();
    // As if the first attempt had crashed before it recorded its run.
    await h.db
      .update(dotRun)
      .set({ outcome: null, runId: null })
      .where(eq(dotRun.id, first.id));
    await retry();
    await h.services.executor.idle();

    expect(
      (await runsOf(schedule.id)).map((run) => [
        run.id,
        run.outcome === "skipped" ? null : run.runId,
      ])
    ).toEqual([[first.id, first.runId]]);
    expect(await chats()).toEqual(before);
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

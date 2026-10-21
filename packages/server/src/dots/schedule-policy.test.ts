import { REPORT_TOOL } from "@workspace/ai/schedules/tool";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  ScheduleNotify,
  ScheduleRunOutcome,
} from "@workspace/contract/schemas/schedules";
import type { ScheduleRow } from "@workspace/db/queries/dots";
import { describe, expect, it } from "vitest";
import {
  BUSY_RETRY_MS,
  checkRecurrence,
  concludeRun,
  planDue,
  shouldNotify,
  toSchedule,
} from "./schedule-policy";

// Schedules' pure core (173, 175): the tick's decisions, the outcome a run
// reports, and whether it tells the owner.

const NOW = new Date("2026-10-20T09:00:30.000Z");

const row = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  autoApproveTools: [],
  completedAt: null,
  conversationId: "0199f000-0000-7000-8000-0000000000c1" as never,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  cron: null,
  dotId: null,
  enabled: true,
  endsAt: null,
  id: "0199f000-0000-7000-8000-0000000000s1" as never,
  lastOutcome: null,
  lastRunAt: null,
  lastStatus: null,
  missedRunPolicy: "run_once",
  nextRunAt: new Date("2026-10-20T09:00:00Z"),
  nextRunNominalAt: new Date("2026-10-20T09:00:00Z"),
  notify: "important",
  ownerId: "0199f000-0000-7000-8000-0000000000u1" as never,
  pausedReason: null,
  prompt: "Check the build.",
  readOnly: true,
  rrule: "FREQ=HOURLY",
  startAt: new Date("2026-10-20T00:00:00Z"),
  targetKind: "conversation",
  timezone: "UTC",
  title: "Build check",
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  ...overrides,
});

const idle = { busy: false, runsToday: 0 };
const limits = { maxRunsPerUserPerDay: 24 };

describe("planDue", () => {
  it("fires a due slot and moves on to the next one", () => {
    const decision = planDue(row(), NOW, idle, limits);
    expect(decision.fire).toEqual({
      missedSlots: 0,
      nominal: new Date("2026-10-20T09:00:00Z"),
    });
    expect(decision.patch.nextRunNominalAt).toEqual(
      new Date("2026-10-20T10:00:00Z")
    );
    expect(decision.patch.completedAt).toBeNull();
    expect(decision.skip).toBeNull();
  });

  it("collapses slots missed during downtime into one run", () => {
    const late = new Date("2026-10-20T12:30:00Z");
    const decision = planDue(row(), late, idle, limits);
    expect(decision.fire?.missedSlots).toBe(3);
    // Resumes from now, not by replaying 10:00 and 11:00.
    expect(decision.patch.nextRunNominalAt).toEqual(
      new Date("2026-10-20T13:00:00Z")
    );
  });

  it("skips a late slot with the skip policy", () => {
    const decision = planDue(
      row({ missedRunPolicy: "skip" }),
      new Date("2026-10-20T09:30:00Z"),
      idle,
      limits
    );
    expect(decision.fire).toBeNull();
    expect(decision.skip).toMatchObject({ skipReason: "missed" });
  });

  it("defers a busy target by a minute, keeping the slot", () => {
    const decision = planDue(row(), NOW, { ...idle, busy: true }, limits);
    expect(decision.fire).toBeNull();
    expect(decision.skip).toBeNull();
    expect(decision.patch).toEqual({
      nextRunAt: new Date(NOW.getTime() + BUSY_RETRY_MS),
    });
  });

  it("skips as busy once the next slot would arrive first", () => {
    const decision = planDue(
      row(),
      new Date("2026-10-20T09:59:30Z"),
      { ...idle, busy: true },
      limits
    );
    expect(decision.skip).toMatchObject({
      notified: false,
      outcome: "skipped",
      skipReason: "busy",
    });
    expect(decision.patch.nextRunNominalAt).toEqual(
      new Date("2026-10-20T10:00:00Z")
    );
  });

  it("skips and records the cap once today's runs are used", () => {
    const decision = planDue(row(), NOW, { ...idle, runsToday: 24 }, limits);
    expect(decision.fire).toBeNull();
    expect(decision.skip).toMatchObject({ skipReason: "cap" });
    expect(decision.patch.lastOutcome).toBe("skipped");
  });

  it("completes a one-off after it fires", () => {
    const decision = planDue(
      row({
        nextRunAt: new Date("2026-10-20T09:00:00Z"),
        rrule: "FREQ=DAILY;COUNT=1",
        startAt: new Date("2026-10-20T09:00:00Z"),
      }),
      NOW,
      idle,
      limits
    );
    expect(decision.fire).not.toBeNull();
    expect(decision.patch).toMatchObject({
      completedAt: NOW,
      nextRunAt: null,
      nextRunNominalAt: null,
    });
  });

  it("waits on a busy chat for a one-off, then gives it up as busy", () => {
    const once = row({
      rrule: "FREQ=DAILY;COUNT=1",
      startAt: new Date("2026-10-20T09:00:00Z"),
    });
    const busy = { ...idle, busy: true };
    expect(planDue(once, NOW, busy, limits)).toMatchObject({
      fire: null,
      skip: null,
    });

    const hourLater = new Date("2026-10-20T10:00:30Z");
    const late = planDue(once, hourLater, busy, limits);
    expect(late.skip).toMatchObject({ skipReason: "busy" });
    expect(late.patch).toMatchObject({
      completedAt: hourLater,
      nextRunAt: null,
    });
  });

  it("pauses a heartbeat whose chat is gone", () => {
    const decision = planDue(row({ conversationId: null }), NOW, idle, limits);
    expect(decision.fire).toBeNull();
    expect(decision.patch).toMatchObject({
      enabled: false,
      pausedReason: "target_archived",
    });
  });
});

describe("shouldNotify", () => {
  const cases: [ScheduleRunOutcome, Record<ScheduleNotify, boolean>][] = [
    ["update", { all: true, failures: false, important: false, none: false }],
    [
      "needs_attention",
      { all: true, failures: false, important: true, none: false },
    ],
    ["failed", { all: true, failures: true, important: true, none: false }],
    [
      "no_update",
      { all: false, failures: false, important: false, none: false },
    ],
    ["skipped", { all: false, failures: false, important: false, none: false }],
  ];
  it.each(cases)("%s", (outcome, expected) => {
    for (const [policy, notifies] of Object.entries(expected)) {
      expect(shouldNotify(outcome, policy as ScheduleNotify)).toBe(notifies);
    }
  });
});

const text = (value: string): MessagePart => ({ text: value, type: "text" });
const report = (input: unknown): MessagePart => ({
  approval: { state: "not-required" },
  input: input as never,
  toolCallId: "call-1",
  toolName: REPORT_TOOL,
  type: "tool-call",
});

describe("concludeRun", () => {
  it("takes the outcome the run reported", () => {
    expect(
      concludeRun("succeeded", [
        text("Two new invoices."),
        report({
          outcome: "needs_attention",
          summary: "2 invoices to approve",
        }),
      ])
    ).toEqual({ outcome: "needs_attention", summary: "2 invoices to approve" });
  });

  it("falls back to the reply: text is an update, nothing is no update", () => {
    expect(concludeRun("succeeded", [text("All green.")])).toEqual({
      outcome: "update",
      summary: "All green.",
    });
    expect(concludeRun("succeeded", [])).toEqual({
      outcome: "no_update",
      summary: null,
    });
    expect(concludeRun("succeeded", [text("DONT_NOTIFY")]).outcome).toBe(
      "no_update"
    );
  });

  it("calls a failed run failed, whatever it said", () => {
    expect(
      concludeRun("failed", [report({ outcome: "no_update" })]).outcome
    ).toBe("failed");
  });
});

describe("checkRecurrence", () => {
  const min = { minIntervalMinutes: 60 };

  it("refuses rules more frequent than the minimum interval", () => {
    const checked = checkRecurrence(
      {
        endsAt: null,
        kind: "rrule",
        rrule: "FREQ=MINUTELY;INTERVAL=15",
        startAt: NOW.toISOString(),
        timezone: "UTC",
      },
      NOW,
      min
    );
    expect(!checked.ok && checked.error).toMatchObject({
      path: ["recurrence"],
      type: "too_frequent",
    });
  });

  it("refuses a one-off in the past or over two years out", () => {
    const once = (at: string) =>
      checkRecurrence(
        {
          endsAt: null,
          kind: "rrule",
          rrule: "FREQ=DAILY;COUNT=1",
          startAt: at,
          timezone: "UTC",
        },
        NOW,
        min
      );
    expect(once("2026-10-19T09:00:00Z").ok).toBe(false);
    expect(once("2029-01-01T09:00:00Z").ok).toBe(false);
    const fine = once("2026-10-21T09:00:00Z");
    expect(fine.ok && fine.value).toEqual(new Date("2026-10-21T09:00:00Z"));
  });

  it("says which part of the input is wrong", () => {
    const checked = checkRecurrence(
      { cron: "0 9 * * *", endsAt: null, kind: "cron", timezone: "Nowhere" },
      NOW,
      min
    );
    expect(!checked.ok && checked.error.type).toBe("invalid_timezone");
  });
});

describe("toSchedule", () => {
  it("shows the nominal time and why it's paused", () => {
    expect(toSchedule(row())).toMatchObject({
      nextRunNominalAt: "2026-10-20T09:00:00.000Z",
      status: "active",
      target: { kind: "conversation" },
    });
    expect(
      toSchedule(row({ enabled: false, pausedReason: "failures" }))
    ).toMatchObject({
      nextRunAt: null,
      pausedReason: "failures",
      status: "paused",
    });
    expect(toSchedule(row({ completedAt: NOW, enabled: true })).status).toBe(
      "completed"
    );
  });
});

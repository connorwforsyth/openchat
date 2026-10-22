import { describe, expect, it } from "vitest";

import {
  conversationScheduleSchema,
  createScheduleInputSchema,
  scheduleRecurrenceSchema,
  scheduleRunSchema,
  scheduleTargetSchema,
} from "./schedules";

const CONVERSATION = "0199f0c4-6d1c-7000-8000-000000000001";

const slot = {
  conversationId: CONVERSATION,
  createdAt: "2026-10-20T07:00:00.000Z",
  id: "0199f0c4-6d1c-7000-8000-000000000002",
  missedSlots: 0,
  nominalAt: "2026-10-20T07:00:00.000Z",
  notified: false,
  readAt: null,
  scheduleId: "0199f0c4-6d1c-7000-8000-000000000003",
  trigger: "scheduled",
};

const started = {
  ...slot,
  error: null,
  finishedAt: null,
  outcome: null,
  runId: "0199f0c4-6d1c-7000-8000-000000000004",
  status: "running",
  summary: null,
};

describe("schedule schemas", () => {
  it("round-trips each target", () => {
    for (const target of [
      { kind: "dot" },
      { conversationId: CONVERSATION, kind: "conversation" },
      { kind: "new_chat_each_run" },
    ]) {
      expect(scheduleTargetSchema.parse(target)).toEqual(target);
    }
  });

  it("refuses a conversation target without its id", () => {
    expect(
      scheduleTargetSchema.safeParse({ kind: "conversation" }).success
    ).toBe(false);
  });

  it("round-trips both recurrence kinds, defaulting endsAt to null", () => {
    expect(
      scheduleRecurrenceSchema.parse({
        kind: "rrule",
        rrule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
        startAt: "2026-10-20T07:00:00.000Z",
        timezone: "Europe/London",
      })
    ).toEqual({
      endsAt: null,
      kind: "rrule",
      rrule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
      startAt: "2026-10-20T07:00:00.000Z",
      timezone: "Europe/London",
    });
    expect(
      scheduleRecurrenceSchema.parse({
        cron: "0 9 * * 1-5",
        kind: "cron",
        timezone: "UTC",
      }).kind
    ).toBe("cron");
  });

  it("fills create defaults: important notifications, collapse missed runs", () => {
    const input = createScheduleInputSchema.parse({
      prompt: "Brief me",
      recurrence: { cron: "0 8 * * *", kind: "cron", timezone: "UTC" },
      target: { kind: "dot" },
      title: "Morning brief",
    });
    expect(input).toMatchObject({
      autoApproveTools: [],
      missedRunPolicy: "run_once",
      notify: "important",
      paused: false,
    });
    expect(input.readOnly).toBeUndefined();
  });

  it("caps the prompt so a run doesn't resend an essay", () => {
    expect(
      createScheduleInputSchema.safeParse({
        prompt: "x".repeat(4001),
        recurrence: { cron: "0 8 * * *", kind: "cron", timezone: "UTC" },
        target: { kind: "dot" },
        title: "Long",
      }).success
    ).toBe(false);
  });

  it("parses the conversation's schedule summary", () => {
    expect(
      conversationScheduleSchema.parse({
        id: CONVERSATION,
        nextRunNominalAt: null,
        status: "paused",
        title: "Heartbeat",
      }).status
    ).toBe("paused");
  });

  it("parses a run in flight and a skipped slot as the two run shapes", () => {
    expect(scheduleRunSchema.parse(started)).toEqual(started);
    const skipped = { ...slot, outcome: "skipped", skipReason: "cap" };
    expect(scheduleRunSchema.parse(skipped)).toEqual(skipped);
  });

  it("refuses a skipped slot without a reason", () => {
    expect(
      scheduleRunSchema.safeParse({ ...slot, outcome: "skipped" }).success
    ).toBe(false);
  });

  it("refuses a run that isn't skipped but has no run", () => {
    expect(
      scheduleRunSchema.safeParse({
        ...started,
        outcome: "update",
        runId: null,
        status: null,
      }).success
    ).toBe(false);
  });
});

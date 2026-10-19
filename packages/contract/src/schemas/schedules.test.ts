import { describe, expect, it } from "vitest";

import {
  conversationScheduleSchema,
  createScheduleInputSchema,
  scheduleRecurrenceSchema,
  scheduleTargetSchema,
} from "./schedules";

const CONVERSATION = "0199f0c4-6d1c-7000-8000-000000000001";

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
});

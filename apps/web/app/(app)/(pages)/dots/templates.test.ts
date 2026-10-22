import type { DotActivity } from "@workspace/contract/schemas/dots";
import { describe, expect, it } from "vitest";
import { unseenRuns } from "./activity";
import { DOT_AVATAR_COLORS, DOT_AVATAR_STYLES } from "./dot-avatar";
import { describeCron } from "./schedule";
import {
  createInputOf,
  DOT_TEMPLATE_IDS,
  suggestedAvatar,
  TEMPLATE_CRON,
} from "./templates";

const target = { model: "test:model", type: "model" } as const;

describe("createInputOf", () => {
  it("trims what the owner typed and keeps the starter schedule", () => {
    const input = createInputOf(
      {
        avatar: { color: "dusk", style: "blob" },
        name: "  Pip ",
        purpose: " Inbox zero. ",
        schedule: { cron: "0 8 * * *", prompt: "Brief me.", timezone: "UTC" },
      },
      target,
      true
    );
    expect(input).toMatchObject({
      avatar: { color: "dusk", style: "blob" },
      instructions: "Inbox zero.",
      name: "Pip",
      primary: true,
      schedules: [{ cron: "0 8 * * *", enabled: true, prompt: "Brief me." }],
    });
  });

  it("makes no schedule when none was kept", () => {
    const input = createInputOf(
      {
        avatar: { color: "sea", style: "orb" },
        name: "Pip",
        purpose: "",
        schedule: null,
      },
      target,
      false
    );
    expect(input.schedules).toEqual([]);
    expect(input.primary).toBe(false);
  });
});

describe("templates", () => {
  it("each starts on a schedule people can read", () => {
    for (const id of DOT_TEMPLATE_IDS) {
      expect(describeCron(TEMPLATE_CRON[id]).type).not.toBe("custom");
    }
  });

  it("gives each new Dot a different look", () => {
    const first = suggestedAvatar(0, DOT_AVATAR_STYLES, DOT_AVATAR_COLORS);
    const second = suggestedAvatar(1, DOT_AVATAR_STYLES, DOT_AVATAR_COLORS);
    expect(first).not.toEqual(second);
  });
});

const run = (finishedAt: string | null): DotActivity => ({
  error: null,
  finishedAt,
  outcome: null,
  runId: `run-${finishedAt}` as DotActivity["runId"],
  scheduleId: null,
  snippet: "Hi.",
  startedAt: "2026-10-16T08:00:00.000Z",
  status: finishedAt ? "succeeded" : "running",
  trigger: "schedule",
});

describe("unseenRuns", () => {
  it("keeps finished runs after the last look, or all before the first", () => {
    const runs = [
      run("2026-10-16T09:00:00.000Z"),
      run("2026-10-16T07:00:00.000Z"),
      run(null),
    ];
    expect(unseenRuns(runs, "2026-10-16T08:00:00.000Z")).toHaveLength(1);
    expect(unseenRuns(runs, null)).toHaveLength(2);
  });
});

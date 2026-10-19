import { describe, expect, it } from "vitest";

import { parseWhen } from "./parse-when";

// Tuesday 20 Oct 2026, 10:00 in London (09:00 UTC, BST).
const context = {
  now: new Date("2026-10-20T09:00:00.000Z"),
  timezone: "Europe/London",
};

const ruleOf = (text: string) => {
  const parsed = parseWhen(text, context);
  if (!parsed.ok) {
    throw new Error(`${text}: ${parsed.error.type}`);
  }
  return parsed.value.kind === "rrule" ? parsed.value : null;
};

describe("parseWhen", () => {
  it.each([
    ["every day at 8am", "FREQ=DAILY;BYHOUR=8;BYMINUTE=0"],
    ["daily at 8:30", "FREQ=DAILY;BYHOUR=8;BYMINUTE=30"],
    ["every morning", "FREQ=DAILY;BYHOUR=8;BYMINUTE=0"],
    ["every evening at 6:15pm", "FREQ=DAILY;BYHOUR=18;BYMINUTE=15"],
    [
      "Every weekday at 9",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
    ],
    [
      "weekdays at noon",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=12;BYMINUTE=0",
    ],
    [
      "every Monday and Friday at 10:00",
      "FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=10;BYMINUTE=0",
    ],
    [
      "every other monday at 9am",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
    ],
    ["on mondays at 7pm", "FREQ=WEEKLY;BYDAY=MO;BYHOUR=19;BYMINUTE=0"],
    ["weekly", "FREQ=WEEKLY;BYDAY=TU;BYHOUR=9;BYMINUTE=0"],
    ["weekends at 10am", "FREQ=WEEKLY;BYDAY=SU,SA;BYHOUR=10;BYMINUTE=0"],
    [
      "every month on the 1st at 9",
      "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0",
    ],
    ["every 3 days at 7am", "FREQ=DAILY;INTERVAL=3;BYHOUR=7;BYMINUTE=0"],
    ["every 2 hours", "FREQ=HOURLY;INTERVAL=2"],
    ["hourly", "FREQ=HOURLY"],
    ["every 90 minutes", "FREQ=MINUTELY;INTERVAL=90"],
  ])("reads %j", (text, rule) => {
    const parsed = ruleOf(text);
    expect(parsed?.rrule).toBe(rule);
    expect(parsed?.timezone).toBe("Europe/London");
  });

  it.each([
    ["tomorrow at 9am", "2026-10-21T08:00:00.000Z"],
    ["today at 5pm", "2026-10-20T16:00:00.000Z"],
    ["at 5pm", "2026-10-20T16:00:00.000Z"],
    ["at 8am", "2026-10-21T07:00:00.000Z"],
    ["next friday at 3pm", "2026-10-23T14:00:00.000Z"],
    ["on 2026-11-03 at 10:00", "2026-11-03T10:00:00.000Z"],
    ["in 2 hours", "2026-10-20T11:00:00.000Z"],
    ["in 30 minutes", "2026-10-20T09:30:00.000Z"],
  ])("reads the one-off %j", (text, at) => {
    const parsed = ruleOf(text);
    expect(parsed?.rrule).toBe("FREQ=DAILY;COUNT=1");
    expect(parsed?.startAt).toBe(at);
  });

  it("says a one-off in the past is in the past", () => {
    const parsed = parseWhen("today at 8am", context);
    expect(!parsed.ok && parsed.error.type).toBe("in_past");
  });

  it.each(["", "whenever you like", "sometimes"])(
    "doesn't guess at %j",
    (text) => {
      const parsed = parseWhen(text, context);
      expect(!parsed.ok && parsed.error.type).toBe("unrecognised");
    }
  );
});

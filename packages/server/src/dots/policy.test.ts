import type { RunId } from "@workspace/contract/schemas/common";
import type { DotLastRun } from "@workspace/contract/schemas/dots";
import { describe, expect, it } from "vitest";

import {
  DOT_RUN_KEY_PREFIX,
  dotPersona,
  dotRunKey,
  dotStatusOf,
  handleFrom,
  isDotRunKey,
  isUnread,
  shouldAutoPause,
  snippetOf,
  UNATTENDED_REFUSAL,
  unattendedApproval,
} from "./policy";

const at = (iso: string) => new Date(iso);

describe("unattendedApproval", () => {
  it("refuses ask tools, auto-approves allowed ones, leaves the rest", () => {
    const result = unattendedApproval(
      {
        bash: "user-approval",
        read: "not-applicable",
        web_search: undefined,
        write: "user-approval",
      },
      ["bash"]
    );
    expect(result.toolApproval).toEqual({
      bash: "not-applicable",
      read: "not-applicable",
      web_search: undefined,
    });
    expect(result.refused).toEqual({ write: UNATTENDED_REFUSAL });
  });

  it("never leaves a tool that would pause the run", () => {
    const result = unattendedApproval(
      { a: "user-approval", b: "user-approval" },
      []
    );
    expect(Object.values(result.toolApproval)).not.toContain("user-approval");
    expect(Object.keys(result.refused)).toEqual(["a", "b"]);
  });
});

const lastRun = (overrides: Partial<DotLastRun>): DotLastRun => ({
  error: null,
  finishedAt: "2026-10-16T08:01:10.000Z",
  outcome: null,
  runId: "0199f000-0000-7000-8000-000000000000" as RunId,
  scheduleId: null,
  snippet: null,
  startedAt: "2026-10-16T08:01:00.000Z",
  status: "succeeded",
  trigger: "schedule",
  ...overrides,
});

describe("list state", () => {
  it("derives the pill", () => {
    expect(dotStatusOf(null)).toBe("idle");
    expect(dotStatusOf(lastRun({ status: "running" }))).toBe("running");
    expect(dotStatusOf(lastRun({ status: "failed" }))).toBe("failed");
    expect(dotStatusOf(lastRun({ status: "succeeded" }))).toBe("idle");
  });

  it("is unread when a run finished after the last view", () => {
    const run = lastRun({});
    expect(isUnread(run, null)).toBe(true);
    expect(isUnread(run, at("2026-10-16T08:00:00Z"))).toBe(true);
    expect(isUnread(run, at("2026-10-16T08:02:00Z"))).toBe(false);
    expect(isUnread(lastRun({ finishedAt: null }), null)).toBe(false);
    expect(isUnread(null, null)).toBe(false);
  });

  it("snips the reply's text", () => {
    expect(snippetOf(null)).toBeNull();
    expect(
      snippetOf([
        { text: "Good\n morning.", type: "text" },
        { text: "Done.", type: "text" },
      ])
    ).toBe("Good morning. Done.");
    expect(snippetOf([{ text: "x".repeat(400), type: "text" }])).toHaveLength(
      280
    );
  });

  it("pauses after three failures in a row", () => {
    expect(shouldAutoPause(["failed", "failed", "failed"])).toBe(true);
    expect(shouldAutoPause(["failed", "succeeded", "failed"])).toBe(false);
    expect(shouldAutoPause(["failed", "failed"])).toBe(false);
  });
});

describe("dotRunKey", () => {
  it("is stable per occurrence and recognisable", () => {
    const key = dotRunKey({
      occurrence: at("2026-10-16T08:00:00Z"),
      scheduleId: "s1",
      type: "schedule",
    });
    expect(key).toBe(`${DOT_RUN_KEY_PREFIX}s:s1:2026-10-16T08:00:00.000Z`);
    expect(isDotRunKey(key)).toBe(true);
    expect(isDotRunKey(dotRunKey({ nonce: "n", type: "manual" }))).toBe(true);
    expect(isDotRunKey("composer-123")).toBe(false);
    expect(isDotRunKey(null)).toBe(false);
  });
});

describe("handleFrom", () => {
  it("makes a lowercase handle from the name", () => {
    expect(handleFrom("Pip", [])).toBe("pip");
    expect(handleFrom("Morning Brief!", [])).toBe("morning-brief");
    expect(handleFrom("Zoë", [])).toBe("zoe");
  });

  it("pads one that's too short and names one with nothing usable", () => {
    expect(handleFrom("Q", [])).toBe("q-dot");
    expect(handleFrom("🌟", [])).toBe("dot");
  });

  it("counts up past the owner's taken handles, within 24 characters", () => {
    expect(handleFrom("Pip", ["pip", "pip-2"])).toBe("pip-3");
    const long = "a".repeat(30);
    const taken = ["a".repeat(24)];
    expect(handleFrom(long, taken)).toBe(`${"a".repeat(22)}-2`);
  });
});

describe("dotPersona", () => {
  it("names the Dot and includes only what the owner wrote", () => {
    const bare = dotPersona({
      handle: "pip",
      instructions: " ",
      name: "Pip",
      rules: "",
    });
    expect(bare).toContain("You are Pip (@pip)");
    expect(bare).toContain("schedule_task");
    expect(bare).not.toContain("rules");
    const full = dotPersona({
      handle: "pip",
      instructions: "Inbox zero.",
      name: "Pip",
      rules: "Ask before emailing anyone.",
    });
    expect(full).toContain("Inbox zero.");
    expect(full).toContain("Ask before emailing anyone.");
  });
});

import { describe, expect, it } from "vitest";

import { busyJoin } from "./create-run";

// How a message joins a busy branch, by the busy run's state (pure).

const me = "u-me" as never;
const base = {
  actorId: me,
  asked: "steer" as const,
  batches: true,
  toolWork: false,
};
const tail = (
  status: "awaiting_approval" | "queued" | "running",
  extra: { createdBy?: string; unattended?: unknown } = {}
) =>
  ({
    createdBy: extra.createdBy ?? me,
    status,
    unattended: extra.unattended ?? null,
  }) as never;

describe("busyJoin", () => {
  it("joins a waiting turn, restarts a writing answer, steers one at work", () => {
    expect(busyJoin({ ...base, tail: tail("queued") })).toBe("join");
    expect(busyJoin({ ...base, tail: tail("running") })).toBe("restart");
    expect(busyJoin({ ...base, tail: tail("running"), toolWork: true })).toBe(
      "steer"
    );
  });

  it("queues anything else", () => {
    expect(busyJoin({ ...base, asked: undefined, tail: tail("running") })).toBe(
      "queue"
    );
    expect(busyJoin({ ...base, batches: false, tail: tail("running") })).toBe(
      "queue"
    );
    expect(
      busyJoin({ ...base, tail: tail("running", { createdBy: "u-other" }) })
    ).toBe("queue");
    expect(busyJoin({ ...base, tail: tail("awaiting_approval") })).toBe(
      "queue"
    );
    // A Dot's scheduled or check-in run is its own.
    expect(
      busyJoin({
        ...base,
        tail: tail("running", { unattended: { type: "check_in" } }),
      })
    ).toBe("queue");
  });
});

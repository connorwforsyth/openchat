import { describe, expect, it } from "vitest";

import {
  manualCheckOutcome,
  nextUpdateState,
  type UpdateEvent,
  type UpdateState,
  updateMenuItem,
} from "./update-state";

const run = (state: UpdateState, events: readonly UpdateEvent[]) =>
  events.reduce(nextUpdateState, state);

describe("nextUpdateState", () => {
  it("goes from a check through the download to waiting for a restart", () => {
    expect(
      run({ kind: "idle" }, [
        { manual: false, type: "check" },
        { type: "available", version: "1.2.0" },
        { percent: 41.6, type: "progress" },
      ])
    ).toEqual({ kind: "downloading", percent: 42, version: "1.2.0" });
    expect(
      run({ kind: "idle" }, [
        { manual: false, type: "check" },
        { type: "available", version: "1.2.0" },
        { type: "downloaded", version: "1.2.0" },
      ])
    ).toEqual({ kind: "downloaded", version: "1.2.0" });
  });

  it("returns to idle when there's nothing new", () => {
    expect(
      run({ kind: "idle" }, [
        { manual: true, type: "check" },
        { type: "not-available" },
      ])
    ).toEqual({ kind: "idle" });
  });

  it("remembers whether the person asked", () => {
    expect(
      nextUpdateState({ kind: "idle" }, { manual: true, type: "check" })
    ).toEqual({
      kind: "checking",
      manual: true,
    });
    // A timed check while the person's is running doesn't take it over.
    expect(
      nextUpdateState(
        { kind: "checking", manual: true },
        { manual: false, type: "check" }
      )
    ).toEqual({ kind: "checking", manual: true });
  });

  it("can check again after an error", () => {
    expect(
      run({ kind: "idle" }, [
        { manual: false, type: "check" },
        { message: "offline", type: "error" },
        { manual: true, type: "check" },
      ])
    ).toEqual({ kind: "checking", manual: true });
  });

  it("keeps a downloaded update whatever happens next", () => {
    const downloaded: UpdateState = { kind: "downloaded", version: "1.2.0" };
    expect(
      run(downloaded, [
        { manual: true, type: "check" },
        { type: "not-available" },
        { message: "offline", type: "error" },
      ])
    ).toBe(downloaded);
  });

  it("ignores everything while off", () => {
    const off: UpdateState = { kind: "off", reason: "build" };
    expect(run(off, [{ manual: true, type: "check" }])).toBe(off);
  });

  it("clamps progress", () => {
    const downloading: UpdateState = {
      kind: "downloading",
      percent: 0,
      version: "1.2.0",
    };
    expect(
      nextUpdateState(downloading, { percent: 140, type: "progress" })
    ).toMatchObject({
      percent: 100,
    });
  });
});

describe("updateMenuItem", () => {
  it("offers nothing while updates are off", () => {
    expect(updateMenuItem({ kind: "off", reason: "unpackaged" })).toBeNull();
  });

  it("offers a check, disabled while one runs", () => {
    expect(updateMenuItem({ kind: "idle" })).toEqual({
      enabled: true,
      kind: "check",
    });
    expect(updateMenuItem({ kind: "checking", manual: false })).toEqual({
      enabled: false,
      kind: "check",
    });
    expect(updateMenuItem({ kind: "error", message: "x" })).toEqual({
      enabled: true,
      kind: "check",
    });
  });

  it("shows the download, then offers the restart", () => {
    expect(
      updateMenuItem({ kind: "downloading", percent: 30, version: "1.2.0" })
    ).toEqual({ kind: "downloading", percent: 30 });
    expect(updateMenuItem({ kind: "downloaded", version: "1.2.0" })).toEqual({
      kind: "restart",
      version: "1.2.0",
    });
  });
});

describe("manualCheckOutcome", () => {
  const asked: UpdateState = { kind: "checking", manual: true };

  it("says up to date or failed only for a check the person asked for", () => {
    expect(manualCheckOutcome(asked, { kind: "idle" })).toBe("up-to-date");
    expect(manualCheckOutcome(asked, { kind: "error", message: "x" })).toBe(
      "failed"
    );
    expect(
      manualCheckOutcome({ kind: "checking", manual: false }, { kind: "idle" })
    ).toBeNull();
  });

  it("says nothing when an update was found (the menu shows it)", () => {
    expect(
      manualCheckOutcome(asked, {
        kind: "downloading",
        percent: 0,
        version: "1.2.0",
      })
    ).toBeNull();
  });
});

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isAbandoned, release, tryAcquire } from "./browser-lock";

const freshLock = () =>
  join(mkdtempSync(join(tmpdir(), "browser-lock-")), "lock");

// No process has this pid (pids top out far below it).
const DEAD_PID = 2 ** 30;

describe("browser-lock", () => {
  it("lets one holder in at a time", () => {
    const lock = freshLock();
    expect(tryAcquire(lock)).toBe(true);
    expect(tryAcquire(lock)).toBe(false);
    release(lock);
    expect(existsSync(lock)).toBe(false);
    expect(tryAcquire(lock)).toBe(true);
  });

  it("takes over a lock whose holder has exited", () => {
    const lock = freshLock();
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(DEAD_PID));
    expect(isAbandoned(lock)).toBe(true);
    expect(tryAcquire(lock)).toBe(true);
  });

  it("waits on a lock that is still being written", () => {
    const lock = freshLock();
    mkdirSync(lock);
    expect(isAbandoned(lock)).toBe(false);
    expect(tryAcquire(lock)).toBe(false);
  });

  it("only releases its own lock", () => {
    const lock = freshLock();
    expect(tryAcquire(lock, DEAD_PID - 1)).toBe(true);
    release(lock);
    expect(existsSync(lock)).toBe(true);
  });
});

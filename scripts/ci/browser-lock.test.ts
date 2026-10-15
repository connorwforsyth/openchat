import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCK_DIR,
  isAbandoned,
  lockDirFor,
  parseInvocation,
  release,
  tryAcquire,
} from "./browser-lock";

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

  it("keeps the browser-mode lock as the default", () => {
    expect(lockDirFor()).toBe(DEFAULT_LOCK_DIR);
    expect(parseInvocation(["vitest", "run"])).toEqual({
      ok: true,
      value: { args: ["run"], command: "vitest" },
    });
  });

  it("holds a named lock apart from the default", () => {
    expect(parseInvocation(["--name", "next-build", "next", "build"])).toEqual({
      ok: true,
      value: { args: ["build"], command: "next", name: "next-build" },
    });
    const named = lockDirFor("next-build");
    expect(named).not.toBe(DEFAULT_LOCK_DIR);
    expect(named.endsWith("next-build.lock")).toBe(true);

    // Two names never block each other; one name admits one holder.
    const parent = mkdtempSync(join(tmpdir(), "browser-lock-"));
    const build = join(parent, "next-build.lock");
    const browser = join(parent, "vitest-browser-mode.lock");
    expect(tryAcquire(build)).toBe(true);
    expect(tryAcquire(browser)).toBe(true);
    expect(tryAcquire(build)).toBe(false);
    release(build);
    release(browser);
  });

  it("refuses a missing command or a name that isn't a plain word", () => {
    for (const argv of [
      [],
      ["--name", "next-build"],
      ["--name", "../escape", "next", "build"],
      ["--name", "", "next", "build"],
    ]) {
      expect(parseInvocation(argv).ok).toBe(false);
    }
  });
});

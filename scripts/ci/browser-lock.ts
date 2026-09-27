// Runs a command while holding a machine-wide lock, so only one Vitest
// browser-mode run (one Chromium and one Vite server) is up at a time.
//
//   bun ../../scripts/ci/browser-lock.ts vitest run
//
// Ticket 043: turbo starts every browser package's `test` at once beside the
// typechecks and builds, and on a loaded laptop or CI runner the Chromium
// tabs then fail to connect or tests time out. The lock lives in the OS temp
// directory, so runs from other worktrees on the same machine queue too.
// Unit-test packages don't take it and stay parallel; so does a root
// `vitest run`, which is one process.
import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_LOCK_DIR = join(tmpdir(), "vitest-browser-mode.lock");

const OWNER_FILE = "pid";
const POLL_MS = 250;
// Between `mkdir` and writing the pid a lock has no owner yet; only an
// ownerless lock older than this is treated as abandoned.
const OWNERLESS_GRACE_MS = 10_000;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readOwner = (lockDir: string): number | undefined => {
  try {
    const pid = Number.parseInt(
      readFileSync(join(lockDir, OWNER_FILE), "utf8"),
      10
    );
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
};

const ageMs = (path: string): number => {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

/** Whether the lock was left behind by a process that no longer runs. */
export const isAbandoned = (lockDir: string): boolean => {
  const owner = readOwner(lockDir);
  if (owner === undefined) {
    return ageMs(lockDir) > OWNERLESS_GRACE_MS;
  }
  return !isAlive(owner);
};

/** Takes the lock if it is free. `mkdir` is atomic, so one caller wins. */
export const tryAcquire = (lockDir: string, pid = process.pid): boolean => {
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    if (!isAbandoned(lockDir)) {
      return false;
    }
    // Two waiters taking over the same abandoned lock can both get in; that
    // costs only the overlap this lock exists to avoid, never a hang.
    rmSync(lockDir, { force: true, recursive: true });
    return tryAcquire(lockDir, pid);
  }
  writeFileSync(join(lockDir, OWNER_FILE), String(pid));
  return true;
};

/** Frees the lock, but only the one this process holds. */
export const release = (lockDir: string, pid = process.pid): void => {
  if (readOwner(lockDir) === pid) {
    rmSync(lockDir, { force: true, recursive: true });
  }
};

const acquire = (lockDir: string): Promise<void> => {
  if (tryAcquire(lockDir)) {
    return Promise.resolve();
  }
  const owner = readOwner(lockDir);
  console.log(
    `Waiting for another browser test run${owner ? ` (pid ${owner})` : ""} to finish…`
  );
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (tryAcquire(lockDir)) {
        clearInterval(poll);
        resolve();
      }
    }, POLL_MS);
  });
};

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("usage: browser-lock.ts <command> [...args]");
    process.exit(2);
  }
  const lockDir = DEFAULT_LOCK_DIR;

  let child: ChildProcess | undefined;
  const forward = (signal: NodeJS.Signals) => {
    if (child) {
      child.kill(signal);
    } else {
      release(lockDir);
      process.exit(1);
    }
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  process.on("exit", () => release(lockDir));

  await acquire(lockDir);
  child = spawn(command, args, { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
};

if (import.meta.main) {
  await main();
}

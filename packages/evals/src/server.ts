import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The app under test: `e2e/support/serve.ts`, the same server the
// end-to-end suite boots (the production build of apps/web on the embedded
// database in a temporary directory, with the mock model, search and MCP
// stand-ins). It starts with no users, and is torn down with its directory
// when the run ends.

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const SERVE = resolve(REPO_ROOT, "e2e/support/serve.ts");

const BOOT_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 10_000;
/** How much server output is kept for `server.log`. */
const LOG_LIMIT = 2_000_000;

export interface RunningServer {
  readonly baseUrl: string;
  /** What the server and its stand-ins printed. */
  readonly log: () => string;
  readonly stop: () => Promise<void>;
}

const sleep = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });

const portIsFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, () => {
      probe.close(() => done(true));
    });
  });

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }
    child.once("exit", () => done());
  });

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  // SIGTERM, so serve.ts stops Next and deletes its temporary directory.
  child.kill("SIGTERM");
  await Promise.race([exited(child), sleep(STOP_TIMEOUT_MS)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
};

const ready = async (baseUrl: string): Promise<boolean> => {
  try {
    // An API route, so "ready" means booted: the server opens and migrates
    // the embedded database on the first API request.
    const response = await fetch(`${baseUrl}/api/config`, {
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const startServer = async (port: number): Promise<RunningServer> => {
  if (!(await portIsFree(port))) {
    throw new Error(
      `port ${port} is in use; set EVALS_PORT (or --port) to a free one`
    );
  }
  const baseUrl = `http://localhost:${port}`;
  let log = "";
  const keep = (chunk: Buffer) => {
    log = `${log}${chunk.toString("utf8")}`.slice(-LOG_LIMIT);
  };
  const child = spawn(process.execPath, [SERVE], {
    cwd: REPO_ROOT,
    // serve.ts passes the app only what it names; the port is all it needs
    // from here. The debugging switches stay off: the evals are about the
    // production build.
    env: {
      E2E_PORT: String(port),
      HOME: process.env.HOME,
      PATH: process.env.PATH,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  // biome-ignore lint/performance/noAwaitInLoops: polling is sequential by nature.
  while (!(await ready(baseUrl))) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `the server exited while booting (is apps/web built? \`bun run evals\` builds it):\n${log.slice(-2000)}`
      );
    }
    if (Date.now() > deadline) {
      await stopChild(child);
      throw new Error(
        `the server didn't answer within ${BOOT_TIMEOUT_MS / 1000} s:\n${log.slice(-2000)}`
      );
    }
    await sleep(250);
  }
  return { baseUrl, log: () => log, stop: () => stopChild(child) };
};

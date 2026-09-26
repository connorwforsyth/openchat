import { createTestDb, type TestDb } from "@workspace/db/testing";
import { ok } from "@workspace/shared/result";
import { fromPglite, type PGliteLike } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JobRuntime } from "./start";
import { startJobs } from "./start";

// The pg-boss adapter against a real (in-process) Postgres: PGlite, which
// pg-boss 12 supports as a backend. Skipped on a Postgres server run
// (TEST_DATABASE_URL), where the adapter is the same code over `pg`.

let testDb: TestDb;
let jobs: JobRuntime | null = null;

beforeAll(async () => {
  testDb = await createTestDb();
  if (testDb.engine !== "pglite") {
    return;
  }
  const client = (testDb.db as unknown as { $client: PGliteLike }).$client;
  jobs = await startJobs({
    connection: {
      backend: "pglite",
      db: fromPglite(client),
      schedule: false,
      supervise: false,
    },
    pollingIntervalSeconds: 0.5,
  });
});

afterAll(async () => {
  await jobs?.stop();
  await testDb.close();
});

const waitFor = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling until the worker gets to it.
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe.skipIf(process.env.TEST_DATABASE_URL)("pg-boss JobQueue", () => {
  it("works a job, stores its output and dedupes by singleton key", async () => {
    const queue = jobs?.queue;
    if (queue === undefined) {
      throw new Error("pg-boss didn't start on PGlite");
    }
    const seen: string[] = [];
    const worked = await queue.work("run.prune", (task) => {
      seen.push(task.data.runId);
      return Promise.resolve(ok({ pruned: task.data.runId }));
    });
    expect(worked.ok).toBe(true);

    const runId = "01a0de5f-bf67-7628-9db6-f0c96ff5586c" as never;
    const first = await queue.enqueue(
      "run.prune",
      { runId },
      { singletonKey: "prune-1", startAfterSeconds: 0 }
    );
    const duplicate = await queue.enqueue(
      "run.prune",
      { runId },
      { singletonKey: "prune-1" }
    );
    expect(first.ok && first.value).toBeTruthy();
    expect(duplicate).toEqual({ ok: true, value: null });

    const id = first.ok && first.value ? first.value : null;
    if (!id) {
      throw new Error("no job id");
    }
    const job = await waitFor(
      () => queue.getJob(id),
      (found) => found.ok && found.value?.state === "completed"
    );
    expect(job.ok && job.value).toMatchObject({
      id,
      name: "run.prune",
      output: { pruned: runId },
      singletonKey: "prune-1",
      state: "completed",
    });
    expect(seen).toEqual([runId]);
  });

  it("rejects a malformed cron", async () => {
    const result = await jobs?.queue.schedule("eval.run", "every day", {
      suite: "routing",
    });
    expect(result).toMatchObject({
      error: { type: "invalid_cron" },
      ok: false,
    });
  });
});

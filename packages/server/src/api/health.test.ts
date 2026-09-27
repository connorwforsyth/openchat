import { call } from "@orpc/server";
import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { buildRegistry } from "@workspace/ai/providers/registry";
import { appConfigSchema } from "@workspace/config/schema";
import { healthSchema } from "@workspace/contract/schemas/health";
import type { Db } from "@workspace/db/client";
import { createTestDb, type TestDb } from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import {
  checkHealth,
  databaseProbe,
  downProbe,
  type HealthProbes,
  jobsProbe,
} from "./health";
import { createMetaRouter, createPublicConfigRouter } from "./meta";

// `GET /api/health` (042): any answer is liveness; `status` is readiness.
// It needs no session and works with no database at all.

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const config = appConfigSchema.parse({});
const anonymous = {
  context: { request: new Request("http://x"), session: null },
};

const metaWith = (health: HealthProbes) =>
  createMetaRouter({
    config,
    db,
    health,
    keyStore: createMemoryKeyStore([]),
    orgPolicy: () => Promise.resolve({ personalKeyFallback: false }),
    registry: buildRegistry(config),
  }).meta;

describe("health probes", () => {
  it("pings the database", async () => {
    expect(await databaseProbe(db)()).toEqual({ message: null, status: "up" });
  });

  it("reports a failing or hung database as down, without its error", async () => {
    const failing = {
      execute: () => Promise.reject(new Error("postgres://user:pw@db/x")),
    } as unknown as Db;
    const failed = await databaseProbe(failing)();
    expect(failed.status).toBe("down");
    expect(failed.message).not.toContain("postgres://");

    const hung = {
      execute: () => new Promise(() => undefined),
    } as unknown as Db;
    expect(await databaseProbe(hung, 10)()).toEqual({
      message: "the database didn't answer in time",
      status: "down",
    });
  });

  it("is ok only when every check is up", async () => {
    expect(
      await checkHealth({ database: databaseProbe(db), jobs: jobsProbe(true) })
    ).toEqual({
      checks: {
        database: { message: null, status: "up" },
        jobs: { message: null, status: "up" },
      },
      status: "ok",
    });
    const degraded = await checkHealth({
      database: databaseProbe(db),
      jobs: jobsProbe(false),
    });
    expect(degraded.status).toBe("degraded");
    expect(degraded.checks.jobs.status).toBe("down");
  });
});

describe("meta.health", () => {
  it("answers without a session", async () => {
    const meta = metaWith({
      database: databaseProbe(db),
      jobs: jobsProbe(true),
    });
    const report = await call(meta.health, {}, anonymous);
    expect(healthSchema.parse(report).status).toBe("ok");
    expect(await call(meta.health, { ready: true }, anonymous)).toEqual(report);
  });

  it("answers NOT_READY for a readiness probe while degraded", async () => {
    const meta = metaWith({
      database: databaseProbe(db),
      jobs: jobsProbe(false),
    });
    expect((await call(meta.health, {}, anonymous)).status).toBe("degraded");
    await expect(
      call(meta.health, { ready: true }, anonymous)
    ).rejects.toMatchObject({
      code: "NOT_READY",
      data: { status: "degraded" },
      status: 503,
    });
  });

  it("serves GET /api/health from a server with no database", async () => {
    const app = createApp({
      resolveSession: () => Promise.resolve(null),
      routers: createPublicConfigRouter({
        config,
        health: {
          database: downProbe("the database isn't available"),
          jobs: downProbe("the job queue needs the database"),
        },
      }),
      services: null,
    });
    const live = await app.request("/api/health");
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({
      checks: { database: { status: "down" }, jobs: { status: "down" } },
      status: "degraded",
    });
    const ready = await app.request("/api/health?ready=true");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ code: "NOT_READY" });
  });
});

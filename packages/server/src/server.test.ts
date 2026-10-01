import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import { createRun, getRun } from "@workspace/db/queries/runs";
import { expectOk, seedOrg, seedUser } from "@workspace/db/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createServerFromEnv, storageSigningSecret } from "./server";
import { testConfig } from "./testing/harness";

// AGENTS.md: the app boots with an empty `.env`. With no DATABASE_URL that
// means the embedded database; with a bad one, no database at all, and the
// routes that need one say why instead of crashing.

const dirs: string[] = [];

const dataDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "server-boot-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("createServerFromEnv", () => {
  it("boots an empty environment on the embedded database", async () => {
    const logged: string[] = [];
    const server = await createServerFromEnv({
      config: testConfig(),
      dataDir: await dataDir(),
      env: {},
      log: (message) => logged.push(message),
    });
    expect(server.problem).toBeNull();
    expect(server.services).not.toBeNull();
    expect(server.auth).not.toBeNull();
    expect(logged.join("\n")).toContain("DATABASE_URL is not set");

    const run = await server.app.request("/api/runs", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(run.status).toBe(401);
    const unknown = await server.app.request("/api/nothing-here");
    expect(unknown.status).toBe(404);
    // Link previews are mounted, and need a signed-in user (101).
    const preview = await server.app.request(
      "/api/link-preview?url=https%3A%2F%2Fexample.test%2F"
    );
    expect(preview.status).toBe(401);
    await server.stop();
  }, 60_000);

  it("reports an invalid DATABASE_URL without printing it, and still boots", async () => {
    const reported: string[] = [];
    const server = await createServerFromEnv({
      config: testConfig(),
      dataDir: await dataDir(),
      env: { DATABASE_URL: "mysql://user:hunter2@host/db" },
      report: (message) => reported.push(message),
    });
    expect(server.services).toBeNull();
    expect(server.problem).toEqual({ type: "invalid_url" });
    expect(reported.join(" ")).not.toContain("hunter2");

    const run = await server.app.request("/api/runs", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(run.status).toBe(503);
    expect(await run.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const stream = await server.app.request(
      "/api/runs/01a0de5f-bf67-7628-9db6-f0c96ff5586c/stream"
    );
    expect(stream.status).toBe(503);
    // The sign-in page can still say which instance this is.
    expect((await server.app.request("/api/config")).status).toBe(200);
    await server.stop();
  });

  it("fails runs a crash left running when it boots again", async () => {
    const dir = await dataDir();
    const first = await createServerFromEnv({
      config: testConfig(),
      dataDir: dir,
      env: {},
    });
    const { db } = first;
    if (!db) {
      throw new Error("no database");
    }
    const owner = await seedUser(db);
    const personal = await seedOrg(db, owner.id, { isPersonal: true });
    const chat = await createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: owner.id,
    });
    const question = expectOk(
      await insertMessage(db, {
        authorId: owner.id,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "Still there?", type: "text" }],
        role: "user",
      })
    );
    // A run some earlier process claimed and never finished.
    const { run } = await createRun(db, {
      context: { id: personal.id, type: "personal" },
      conversationId: chat.id,
      createdBy: owner.id,
      status: "running",
      target: { model: "test:title", type: "model" },
      userMessageId: question.id,
    });
    await first.stop();

    const second = await createServerFromEnv({
      config: testConfig(),
      dataDir: dir,
      env: {},
    });
    const after = second.db ? expectOk(await getRun(second.db, run.id)) : null;
    expect(after?.status).toBe("failed");
    expect(after?.error).toMatchObject({ retryable: true });
    await second.stop();
  }, 60_000);
});

describe("storageSigningSecret", () => {
  it("derives a stable secret from BETTER_AUTH_SECRET, and none without it", () => {
    const env = { BETTER_AUTH_SECRET: "a-long-random-secret-for-tests-only" };
    const secret = storageSigningSecret(env);
    expect(secret).toBe(storageSigningSecret(env));
    expect(secret).not.toContain(env.BETTER_AUTH_SECRET);
    expect(storageSigningSecret({})).toBeUndefined();
  });
});

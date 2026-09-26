import { describe, expect, it } from "vitest";

import { createServerFromEnv } from "./server";
import { testConfig } from "./testing/harness";

// AGENTS.md: the app boots with an empty `.env`. Without a database the chat
// routes say why instead of crashing, and nothing starts in the background.

describe("createServerFromEnv", () => {
  it("builds a working app from an empty environment", async () => {
    const server = await createServerFromEnv({
      config: testConfig(),
      env: {},
      resolveSession: () => Promise.resolve(null),
    });
    expect(server.services).toBeNull();
    expect(server.jobs).toBeNull();

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

    const unknown = await server.app.request("/api/nothing-here");
    expect(unknown.status).toBe(404);

    await server.stop();
  });

  it("reports an invalid DATABASE_URL without printing it, and still boots", async () => {
    const reported: string[] = [];
    const server = await createServerFromEnv({
      config: testConfig(),
      env: { DATABASE_URL: "mysql://user:hunter2@host/db" },
      report: (message) => reported.push(message),
      resolveSession: () => Promise.resolve(null),
    });
    expect(server.services).toBeNull();
    expect(reported.join(" ")).not.toContain("hunter2");
    await server.stop();
  });
});

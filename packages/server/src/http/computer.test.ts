import type { Dot } from "@workspace/contract/schemas/dots";
import { ok } from "@workspace/shared/result";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import type { DotComputers } from "../dots/computer";
import { createHarness, type Harness, USER_HEADER } from "../testing/harness";
import { computerPath, mountComputerRoutes } from "./computer";

// The live view's routes (172): the client tells "this server has no
// computers" from "not right now" by `code`, and says each in its own words.

let h: Harness;
let dot: Dot;

const fakeComputers: DotComputers = {
  setControl: (_, holder) =>
    Promise.resolve(ok({ holder, url: "http://x-6080.sandbox.localhost/" })),
  tools: () => ({}),
  view: () =>
    Promise.resolve(
      ok({ holder: "agent", url: "http://x-6080.sandbox.localhost/" })
    ),
};

const routes = (computers: DotComputers | undefined) => {
  const app = new Hono();
  mountComputerRoutes(app, {
    computers,
    db: h.db,
    resolveSession: (request) => {
      const id = request.headers.get(USER_HEADER);
      return Promise.resolve(id ? { userId: id as never } : null);
    },
  });
  return (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { ...init.headers, [USER_HEADER]: h.ownerId },
    });
};

beforeEach(async () => {
  h = await createHarness();
  const app = createApp({
    resolveSession: () => Promise.resolve({ userId: h.ownerId }),
    routers: createDotsRouter(h.services.dots),
    services: h.services,
  });
  const created = await app.request("/api/dots", {
    body: JSON.stringify({
      instructions: "Be brief.",
      name: "Scout",
      target: { model: "test:model", type: "model" },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  dot = (await created.json()) as Dot;
});

afterEach(() => h.close());

describe("computer routes", () => {
  it("answers FEATURE_DISABLED when the server has no computers", async () => {
    const response = await routes(undefined)(computerPath(dot.conversationId));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("shows the owner the view and hands them control", async () => {
    const request = routes(fakeComputers);
    const view = await request(computerPath(dot.conversationId));
    expect(await view.json()).toMatchObject({ holder: "agent" });
    const taken = await request(`${computerPath(dot.conversationId)}/control`, {
      body: JSON.stringify({ holder: "user" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await taken.json()).toMatchObject({ holder: "user" });
  });
});

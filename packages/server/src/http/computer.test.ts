import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { listActiveRuns } from "@workspace/db/queries/runs";
import { err, ok } from "@workspace/shared/result";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDotsRouter } from "../api/dots";
import { createApp } from "../app";
import type { DotComputers } from "../dots/computer";
import type { ComputerPowerAction, ComputerView } from "../dots/computer-view";
import {
  createHarness,
  type Harness,
  scriptedModel,
  USER_HEADER,
} from "../testing/harness";
import { computerPath, mountComputerRoutes } from "./computer";

// The live view's routes (172): the client tells "this server has no
// computers" from "not right now" by `code`, and says each in its own words.

let h: Harness;
let dot: Dot;

const VIEW: ComputerView = {
  holder: "agent",
  url: "http://x-6080.sandbox.localhost/",
};

/** Computers that record each restart or reset, with the runs still active then. */
const recordingComputers = () => {
  const calls: { action: ComputerPowerAction; activeRuns: number }[] = [];
  const power =
    (action: ComputerPowerAction) => async (conversationId: ConversationId) => {
      const active = await listActiveRuns(h.db, conversationId);
      calls.push({ action, activeRuns: active.length });
      return ok(VIEW);
    };
  const computers: DotComputers = {
    reset: power("reset"),
    restart: power("restart"),
    setControl: (_, holder) => Promise.resolve(ok({ ...VIEW, holder })),
    tools: () => ({}),
    view: () => Promise.resolve(ok(VIEW)),
  };
  return { calls, computers };
};

const routes = (computers: DotComputers | undefined) => {
  const app = new Hono();
  mountComputerRoutes(app, {
    computers,
    db: h.db,
    executor: h.services.executor,
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

const send = async (text: string, parentId: string | null = null) => {
  const response = await h.request("/api/runs", {
    json: {
      conversationId: dot.conversationId,
      input: { parentId, parts: [{ text, type: "text" }], type: "message" },
      target: { model: "test:model", type: "model" },
    },
    method: "POST",
  });
  if (response.status !== 202) {
    throw new Error(`the turn wasn't accepted (${response.status})`);
  }
  return (await response.json()) as CreateRunOutput;
};

const statusOf = async (runId: string) =>
  ((await (await h.request(`/api/runs/${runId}`)).json()) as Run).state.status;

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
    const request = routes(undefined);
    for (const path of ["", "/restart", "/reset"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time keeps the database quiet.
      const response = await request(
        `${computerPath(dot.conversationId)}${path}`,
        {
          method: path ? "POST" : "GET",
        }
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FEATURE_DISABLED" });
    }
  });

  it("shows the owner the view and hands them control", async () => {
    const request = routes(recordingComputers().computers);
    const view = await request(computerPath(dot.conversationId));
    expect(await view.json()).toMatchObject({ holder: "agent" });
    const taken = await request(`${computerPath(dot.conversationId)}/control`, {
      body: JSON.stringify({ holder: "user" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await taken.json()).toMatchObject({ holder: "user" });
  });

  it.each(["restart", "reset"] as const)(
    "%s stops the Dot's runs first, then answers with the view",
    async (action) => {
      const scripted = scriptedModel();
      h.nextTurn({ model: scripted.model });
      const writing = await send("first");
      const queued = await send("second", writing.userMessageId);
      expect(queued.status).toBe("queued");
      const { calls, computers } = recordingComputers();

      const response = await routes(computers)(
        `${computerPath(dot.conversationId)}/${action}`,
        { method: "POST" }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(VIEW);
      expect(calls).toEqual([{ action, activeRuns: 0 }]);
      expect(await statusOf(writing.runId)).toBe("cancelled");
      expect(await statusOf(queued.runId)).toBe("cancelled");
    }
  );

  it("answers UNAVAILABLE when the computer can't restart", async () => {
    const failing: DotComputers = {
      ...recordingComputers().computers,
      restart: () =>
        Promise.resolve(
          err({
            message: "the sandbox runner is unreachable",
            type: "unavailable",
          })
        ),
    };
    const response = await routes(failing)(
      `${computerPath(dot.conversationId)}/restart`,
      { method: "POST" }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("restarts only the owner's Dot", async () => {
    const { calls, computers } = recordingComputers();
    const app = new Hono();
    mountComputerRoutes(app, {
      computers,
      db: h.db,
      executor: h.services.executor,
      resolveSession: () =>
        Promise.resolve({ userId: "someone-else" as never }),
    });
    const response = await app.request(
      `${computerPath(dot.conversationId)}/restart`,
      { method: "POST" }
    );
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });
});

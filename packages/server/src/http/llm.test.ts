import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { textStream } from "@workspace/ai/testing/mock-models";
import type { UserId } from "@workspace/contract/schemas/common";
import type { LlmProxyRequest } from "@workspace/contract/schemas/llm";
import { transaction } from "@workspace/db/schema/usage";
import { seedOrg, seedUser } from "@workspace/db/testing";
import { err } from "@workspace/shared/result";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createServerFromEnv, type Server } from "../server";
import { parseSse, testConfig, USER_HEADER } from "../testing/harness";
import { handleLlmRoute } from "./llm";

// `POST /api/llm` mounted on the whole server (041): the caller, the chat
// context, keys and usage around 013's proxy. The model is a mock.

let server: Server;
let dir: string;
let userId: UserId;
const model = new MockLanguageModelV4({
  doStream: () => Promise.resolve(textStream("Hello from the proxy")),
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "llm-proxy-"));
  server = await createServerFromEnv({
    config: testConfig(),
    dataDir: dir,
    env: {},
    registry: createMemoryProviderRegistry({
      keyless: ["test"],
      languageModels: { "test:proxy": model },
    }),
    resolveSession: (request) => {
      const id = request.headers.get(USER_HEADER);
      return Promise.resolve(id ? { userId: id as UserId } : null);
    },
  });
  if (!server.db) {
    throw new Error("no database");
  }
  const user = await seedUser(server.db);
  await seedOrg(server.db, user.id, { isPersonal: true });
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await server.stop();
  await rm(dir, { force: true, recursive: true });
});

const body = (overrides: Partial<LlmProxyRequest> = {}): LlmProxyRequest => ({
  context: { type: "personal" },
  model: "test:proxy",
  prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
  stream: true,
  ...overrides,
});

const post = (json: unknown, as: UserId | null = userId) =>
  server.app.request("/api/llm", {
    body: JSON.stringify(json),
    headers: {
      "content-type": "application/json",
      ...(as ? { [USER_HEADER]: as } : {}),
    },
    method: "POST",
  });

describe("POST /api/llm", () => {
  it("streams the model's parts as SSE and records usage against the context", async () => {
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-resolved-model")).toBe("test:proxy");
    const events = parseSse(await response.text()).map((event) => event.data);
    expect(events.at(-1)).toBe("[DONE]");
    const parts = events
      .slice(0, -1)
      .map((data) => JSON.parse(data) as { type: string; delta?: string });
    expect(parts.map((part) => part.type)).toEqual(
      expect.arrayContaining(["text-delta", "finish"])
    );
    expect(parts.find((part) => part.type === "text-delta")?.delta).toBe(
      "Hello from the proxy"
    );

    const { db } = server;
    if (!db) {
      throw new Error("no database");
    }
    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(transaction)
        .where(eq(transaction.userId, userId));
      expect(rows).toEqual([
        expect.objectContaining({
          contextType: "personal",
          inputTokens: 10,
          kind: "chat",
          model: "test:proxy",
          outputTokens: 5,
          paidByType: "instance",
          runId: null,
        }),
      ]);
    });
  });

  it("answers JSON when not streaming", async () => {
    const generating = new MockLanguageModelV4({
      doGenerate: {
        content: [{ text: "json reply", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: 1,
            total: 1,
          },
          outputTokens: { reasoning: undefined, text: 1, total: 1 },
        },
        warnings: [],
      },
    });
    const { db } = server;
    if (!db) {
      throw new Error("no database");
    }
    const response = await handleLlmRoute(
      {
        budget: () => Promise.resolve({ ok: true, value: undefined }),
        config: testConfig(),
        db,
        keyStore: createMemoryKeyStore([]),
        registry: createMemoryProviderRegistry({
          keyless: ["test"],
          languageModels: { "test:json": generating },
        }),
        report: () => undefined,
        resolveSession: () => Promise.resolve({ userId }),
      },
      new Request("http://localhost/api/llm", {
        body: JSON.stringify(body({ model: "test:json", stream: false })),
        method: "POST",
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      content: [{ text: "json reply", type: "text" }],
      resolvedModel: "test:json",
    });
  });

  it("needs a caller", async () => {
    const response = await post(body(), null);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses a context the caller isn't in", async () => {
    const response = await post(
      body({
        context: { id: "01a0de5f-bf67-7628-9db6-f0c96ff5586c", type: "team" },
      } as Partial<LlmProxyRequest>)
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a malformed body before anything else", async () => {
    const response = await post({ model: "test:proxy" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("checks the budget before calling the model", async () => {
    const { db } = server;
    if (!db) {
      throw new Error("no database");
    }
    const calls = model.doStreamCalls.length;
    const response = await handleLlmRoute(
      {
        budget: () =>
          Promise.resolve(
            err({
              limitMicros: 1,
              period: "day" as const,
              principal: { id: userId, type: "user" as const },
              resetsAt: new Date().toISOString(),
              usedMicros: 2,
            })
          ),
        config: testConfig(),
        db,
        keyStore: createMemoryKeyStore([]),
        registry: createMemoryProviderRegistry({
          keyless: ["test"],
          languageModels: { "test:proxy": model },
        }),
        report: () => undefined,
        resolveSession: () => Promise.resolve({ userId }),
      },
      new Request("http://localhost/api/llm", {
        body: JSON.stringify(body()),
        method: "POST",
      })
    );
    expect(await response.json()).toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(model.doStreamCalls.length).toBe(calls);
  });
});

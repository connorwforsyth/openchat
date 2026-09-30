import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { textStream } from "@workspace/ai/testing/mock-models";
import type { ModelPrices } from "@workspace/config/prices";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { personalOrgOf } from "@workspace/db/queries/teams";
import { getSpend, setBudget } from "@workspace/db/queries/usage";
import { transaction } from "@workspace/db/schema/usage";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleLlmRoute } from "../http/llm";
import { createHarness, type Harness, testConfig } from "../testing/harness";

// Cost on usage rows (086): a run's tokens at its model's price in
// `models.prices`, and 0 for a model with no price. The models are mocks
// that report fixed token counts.

// $3 in, $15 out and $0.30 cached in, per million tokens.
const prices: ModelPrices = {
  "test:priced": {
    cachedInputMicros: 300_000,
    inputMicros: 3_000_000,
    outputMicros: 15_000_000,
  },
};

/** 1000 input tokens, 400 of them read from the cache, and 500 output tokens. */
const reply = () =>
  new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve(
        textStream("Done", {
          inputTokens: {
            cacheRead: 400,
            cacheWrite: undefined,
            noCache: 600,
            total: 1000,
          },
          outputTokens: { reasoning: undefined, text: 500, total: 500 },
        })
      ),
  });

// 600 × $3/M + 400 × $0.30/M + 500 × $15/M, in micro-USD.
const RUN_COST = 1800 + 120 + 7500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({
    models: { "test:priced": reply(), "test:unpriced": reply() },
    prices,
    realTurns: true,
  });
});

afterEach(() => h.close());

const send = async (model: string) => {
  const chat = (await (
    await h.request("/api/conversations", { json: {}, method: "POST" })
  ).json()) as Conversation;
  return await h.request("/api/runs", {
    json: {
      conversationId: chat.id,
      input: {
        parentId: null,
        parts: [{ text: "hello", type: "text" }],
        type: "message",
      },
      target: { model, type: "model" },
    },
    method: "POST",
  });
};

const run = async (model: string) => {
  const response = await send(model);
  if (response.status !== 202) {
    throw new Error(`expected 202, got ${response.status}`);
  }
  const created = (await response.json()) as CreateRunOutput;
  await h.services.executor.idle();
  return created.runId;
};

const rows = () =>
  h.db.select().from(transaction).where(eq(transaction.userId, h.ownerId));

const personalOrg = async () => {
  const orgId = await personalOrgOf(h.db, h.ownerId);
  if (!orgId) {
    throw new Error("the owner has no personal org");
  }
  return orgId;
};

const spentToday = async () =>
  getSpend(h.db, await personalOrg(), { id: h.ownerId, type: "user" }, "day");

describe("cost on usage rows", () => {
  it("records a priced model's run at its price", async () => {
    const runId = await run("test:priced");
    expect(await rows()).toEqual([
      expect.objectContaining({
        cachedInputTokens: 400,
        costMicros: RUN_COST,
        inputTokens: 1000,
        model: "test:priced",
        outputTokens: 500,
        runId,
      }),
    ]);
    expect(await spentToday()).toBe(RUN_COST);
  });

  it("records an unpriced model's run at 0, with its tokens", async () => {
    await run("test:unpriced");
    expect(await rows()).toEqual([
      expect.objectContaining({
        costMicros: 0,
        inputTokens: 1000,
        model: "test:unpriced",
        outputTokens: 500,
      }),
    ]);
    expect(await spentToday()).toBe(0);
  });

  it("prices a call through the model proxy the same way", async () => {
    const call = async (model: string) => {
      const response = await handleLlmRoute(
        {
          budget: () => Promise.resolve({ ok: true, value: undefined }),
          config: testConfig(prices),
          db: h.db,
          keyStore: createMemoryKeyStore([]),
          registry: createMemoryProviderRegistry({
            keyless: ["test"],
            languageModels: { [model]: reply() },
          }),
          report: () => undefined,
          resolveSession: () => Promise.resolve({ userId: h.ownerId }),
        },
        new Request("http://localhost/api/llm", {
          body: JSON.stringify({
            context: { type: "personal" },
            model,
            prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
            stream: true,
          }),
          method: "POST",
        })
      );
      expect(response.status).toBe(200);
      await response.text();
    };
    await call("test:priced");
    await call("test:unpriced");
    await vi.waitFor(async () => {
      const recorded = await rows();
      expect(
        recorded
          .map((row) => [row.model, row.costMicros])
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
      ).toEqual([
        ["test:priced", RUN_COST],
        ["test:unpriced", 0],
      ]);
    });
  });
});

// Budgets are unchanged by 086, but they compare against spend, and spend
// was always 0 before prices. This pins what a price now does to them.
describe("budgets once models are priced", () => {
  const hardDailyBudget = async () =>
    setBudget(h.db, {
      hard: true,
      limitMicros: RUN_COST,
      orgId: await personalOrg(),
      period: "day",
      principal: { id: h.ownerId, type: "user" },
    });

  it("a hard budget stops the next run once priced runs have spent it", async () => {
    await hardDailyBudget();
    await run("test:priced");
    const refused = await send("test:priced");
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({
      code: "BUDGET_EXCEEDED",
      data: { limitMicros: RUN_COST, usedMicros: RUN_COST },
    });
    // The budget is the user's, not the model's: every model is refused.
    expect((await send("test:unpriced")).status).toBe(402);
  });

  it("an unpriced model never spends a budget", async () => {
    await hardDailyBudget();
    await run("test:unpriced");
    await run("test:unpriced");
    expect((await send("test:unpriced")).status).toBe(202);
    await h.services.executor.idle();
  });
});

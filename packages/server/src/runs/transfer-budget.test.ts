import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import { appConfigSchema } from "@workspace/config/schema";
import type {
  ConversationId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { getRun } from "@workspace/db/queries/runs";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { createMcp } from "@workspace/mcp/create";
import {
  type McpFixture,
  startMcpFixture,
} from "@workspace/mcp/testing/fixture-server";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { createServices } from "../services";
import { testConfig, USER_HEADER } from "../testing/harness";

// What a chat sends over the wire when its tools answer with a lot (146,
// after T3 Code's transfer-budget tests): ten turns, each calling an MCP
// tool that answers with about 1 MB of text, then the bytes a client
// downloads to replay every run's SSE stream from the start (what a resume
// from cursor 0 costs) and to load the conversation's branch.
//
// Measured with the cap on: 1,054,504 bytes of SSE across the ten runs and
// 1,058,671 bytes of path. Before it: 10,192,044 and 10,196,211.

const MODEL = "test:chat";
const TURNS = 10;
/** What the fake tool answers with, per call. */
const RESULT_CHARS = 1_000_000;

// The budgets, in uncompressed bytes. What moves them:
// `MAX_TOOL_RESULT_CHARS` (packages/mcp/src/result-cap.ts) times `TURNS`,
// since each capped result is sent once in its run's stream and stored once
// in the branch, plus JSON escaping of the result's newlines and the SSE
// framing of each chunk. Raise them only with a reason; without the cap the
// same chat sends ten times as much.
const SSE_BUDGET_BYTES = 1_150_000;
const PATH_BUDGET_BYTES = 1_150_000;

let testDb: TestDb;
let fixture: McpFixture;
beforeAll(async () => {
  [testDb, fixture] = await Promise.all([
    createTestDb(),
    startMcpFixture({ dump: true }),
  ]);
}, 60_000);
afterAll(async () => {
  await Promise.all([testDb.close(), fixture.close()]);
});

/** Each turn calls the tool, then (once approved) answers in a line. */
const scripted = () => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const turn = Math.floor(calls / 2) + 1;
      const step = calls % 2;
      calls += 1;
      return Promise.resolve(
        step === 0
          ? toolCallStream("big__dump", { chars: RESULT_CHARS }, `call-${turn}`)
          : textStream(`Read turn ${turn}.`)
      );
    },
  });
};

const bytesOf = async (response: Response): Promise<number> =>
  (await response.arrayBuffer()).byteLength;

describe("wire budget for large MCP results", () => {
  it("keeps a ten-turn chat's SSE and branch under budget", async () => {
    const { db } = testDb;
    const user = (await seedUser(db)).id as UserId;
    await seedOrg(db, user, { isPersonal: true });
    const mcp = createMcp({
      allowPrivateNetworks: true,
      config: {
        brand: { name: "Test" } as never,
        mcp: appConfigSchema.shape.mcp.parse({
          servers: [{ name: "big", url: fixture.url }],
        }),
      },
      db,
      env: {},
    });
    const model = scripted();
    const services = createServices({
      config: testConfig(),
      db,
      jobs: null,
      registry: createMemoryProviderRegistry({
        keyless: ["test"],
        languageModels: { [MODEL]: model },
      }),
      tools: {
        mcpFor: (id) => mcp.manager.toolSource(id),
        mcpSelectionFor: () =>
          Promise.resolve({
            disabled: new Set(),
            enabled: mcp.registry.instanceServers.map((server) => server.id),
            excludedTools: new Map(),
          }),
      },
    });
    const app = createApp({
      resolveSession: (request) => {
        const userId = request.headers.get(USER_HEADER);
        return Promise.resolve(userId ? { userId: userId as UserId } : null);
      },
      services,
    });
    const call = async (path: string, json?: unknown) => {
      const response = await app.request(path, {
        ...(json === undefined
          ? {}
          : { body: JSON.stringify(json), method: "POST" }),
        headers: { "content-type": "application/json", [USER_HEADER]: user },
      });
      if (response.status >= 300) {
        throw new Error(`${path} answered ${response.status}`);
      }
      return response;
    };

    try {
      const conversation = (await (
        await call("/api/conversations", {})
      ).json()) as Conversation;
      const conversationId = conversation.id as ConversationId;
      let parentId: MessageId | null = null;
      const runs: RunId[] = [];
      for (let turn = 1; turn <= TURNS; turn += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: each turn follows the last answer.
        const created = (await (
          await call("/api/runs", {
            conversationId,
            input: {
              parentId,
              parts: [{ text: `Dump turn ${turn}.`, type: "text" }],
              type: "message",
            },
            target: { model: MODEL, type: "model" },
          })
        ).json()) as CreateRunOutput;
        const runId = created.runId as RunId;
        await services.executor.idle();
        // MCP calls in a plain chat wait for a person.
        const paused = expectOk(await getRun(db, runId));
        expectOk(
          await services.executor.submitApprovals(
            runId,
            (paused.approvals ?? []).map(({ toolCallId }) => ({
              decision: { decision: "approve" as const },
              toolCallId,
            })),
            user
          )
        );
        await services.executor.idle();
        const run = expectOk(await getRun(db, runId));
        expect(run.status).toBe("succeeded");
        parentId = run.assistantMessageId as MessageId;
        runs.push(runId);
      }

      let sseBytes = 0;
      for (const runId of runs) {
        // biome-ignore lint/performance/noAwaitInLoops: one stream at a time, like one tab.
        sseBytes += await bytesOf(await call(`/api/runs/${runId}/stream`));
      }
      const pathBytes = await bytesOf(
        await call(`/api/conversations/${conversationId}/path`)
      );

      expect(fixture.stats.toolCalls).toBeGreaterThanOrEqual(TURNS);
      // The model read a cut result and was told so.
      const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
      expect(prompt).toContain("line 1: ");
      expect(prompt).toContain("characters omitted");
      expect(prompt.length).toBeLessThan(RESULT_CHARS / 2);

      expect(sseBytes).toBeLessThan(SSE_BUDGET_BYTES);
      expect(pathBytes).toBeLessThan(PATH_BUDGET_BYTES);
    } finally {
      await services.stop();
      await mcp.manager.close();
    }
  });
});

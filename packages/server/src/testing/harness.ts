import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { usage } from "@workspace/ai/testing/mock-models";
import { parseConfig } from "@workspace/config/parse";
import type { ModelPrices } from "@workspace/config/prices";
import type { AppConfig } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import {
  createTestDb,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { ok } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type postgres from "postgres";

import { createApp } from "../app";
import type { Jobs } from "../jobs/registry";
import {
  createMemoryJobQueue,
  type MemoryJobQueue,
} from "../ports/job-queue.memory";
import type { ImageModels } from "../runs/images";
import type { SandboxToolSource } from "../runs/sandbox";
import type { SkillFileReader } from "../runs/skills";
import type { Turn } from "../runs/turn";
import { createServices, registerCoreJobs, type Services } from "../services";
import {
  type Listen,
  type PgliteListener,
  pgliteListen,
  postgresListen,
} from "../stream/listen";

// An app over a fresh PGlite with scripted models, for the in-process API
// tests (`app.request()`, AGENTS.md "Testing"). Nothing here reaches a
// provider or the network.

export const USER_HEADER = "x-test-user";

/** The configured defaults, plus a model the memory registry serves for titles. */
export const testConfig = (prices: ModelPrices = {}): AppConfig => {
  const parsed = parseConfig("", {});
  if (!parsed.ok) {
    throw new Error("the default config doesn't parse");
  }
  // Set after parsing: the schema checks refs against configured providers,
  // and the test provider lives only in the memory registry.
  return {
    ...parsed.value,
    models: { ...parsed.value.models, default: "test:title", prices },
  };
};

/** A model's reply, fed by the test: parts go out as they're pushed. */
export interface ScriptedStream {
  readonly end: () => void;
  readonly model: LanguageModelV4;
  readonly push: (...parts: LanguageModelV4StreamPart[]) => void;
}

/** A model whose stream the test drives part by part (for mid-stream disconnects). */
export const scriptedModel = (): ScriptedStream => {
  let sink: ReadableStreamDefaultController<LanguageModelV4StreamPart> | null =
    null;
  const early: LanguageModelV4StreamPart[] = [];
  let ended = false;
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start: (controller) => {
      sink = controller;
      for (const part of early) {
        controller.enqueue(part);
      }
      if (ended) {
        controller.close();
      }
    },
  });
  const model = new MockLanguageModelV4({
    doStream: () => Promise.resolve({ stream }),
  });
  return {
    end: () => {
      ended = true;
      sink?.close();
    },
    model,
    push: (...parts) => {
      for (const part of parts) {
        if (sink) {
          sink.enqueue(part);
        } else {
          early.push(part);
        }
      }
    },
  };
};

export const textParts = {
  delta: (delta: string): LanguageModelV4StreamPart => ({
    delta,
    id: "t1",
    type: "text-delta",
  }),
  finish: (): LanguageModelV4StreamPart => ({
    finishReason: { raw: "stop", unified: "stop" },
    type: "finish",
    usage: usage(12, 4),
  }),
  start: (): LanguageModelV4StreamPart[] => [
    { type: "stream-start", warnings: [] },
    { id: "t1", type: "text-start" },
  ],
  textEnd: (): LanguageModelV4StreamPart => ({ id: "t1", type: "text-end" }),
};

export interface TurnScript {
  readonly model: LanguageModelV4;
  readonly proposeEdits?: Turn["proposeEdits"];
  readonly toolApproval?: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools?: Readonly<Record<string, Tool>>;
}

export interface Harness {
  readonly close: () => Promise<void>;
  readonly db: TestDb["db"];
  readonly jobs: MemoryJobQueue<Jobs>;
  /** Queues the model (and tools) the next agent pass will get. */
  readonly nextTurn: (turn: TurnScript) => void;
  readonly ownerId: UserId;
  /** Calls the app as `userId` (the owner by default). */
  readonly request: (
    path: string,
    init?: RequestInit & { readonly json?: unknown; readonly as?: UserId }
  ) => Promise<Response>;
  readonly services: Services;
}

const listenFor = (testDb: TestDb): Listen => {
  const client = (testDb.db as unknown as { $client: unknown }).$client;
  return testDb.engine === "pglite"
    ? pgliteListen(client as PgliteListener)
    : postgresListen(client as postgres.Sql);
};

export interface HarnessOptions {
  /**
   * Image models for real turns' `generate_image` (138), and whether a call
   * asks (`models.image.approval`, `ask` by default).
   */
  readonly images?: {
    readonly approval?: "ask" | "auto";
    readonly models: ImageModels;
  };
  /** More models the registry serves, by ref (the `test` provider is keyless). */
  readonly models?: Readonly<Record<string, LanguageModelV4>>;
  /** `models.prices` for the test provider's models; none are priced otherwise. */
  readonly prices?: ModelPrices;
  /** Configured providers, by key, for real turns that read their adapter (105). */
  readonly providers?: AppConfig["providers"];
  /**
   * Resolve turns for real (`createTurnResolver`: agents, drafts, tools)
   * over `models`, instead of the scripted `nextTurn` queue.
   */
  readonly realTurns?: boolean;
  /** Sandbox tools for real turns (the sandbox package binds its own over this database). */
  readonly sandbox?: (db: TestDb["db"]) => SandboxToolSource;
  /** A skill's bundled files for real turns' `load_skill` (127), by upload id. */
  readonly skillFiles?: SkillFileReader;
  readonly titleModel?: LanguageModelV4;
}

export const createHarness = async (
  options: HarnessOptions = {}
): Promise<Harness> => {
  const testDb = await createTestDb();
  const { db } = testDb;
  const owner = await seedUser(db);
  await seedOrg(db, owner.id, { isPersonal: true });
  const turns: TurnScript[] = [];
  const jobs = createMemoryJobQueue<Jobs>();
  const base = testConfig(options.prices);
  const config: AppConfig = {
    ...base,
    models: {
      ...base.models,
      image: {
        ...base.models.image,
        approval: options.images?.approval ?? base.models.image.approval,
      },
    },
  };
  const services = createServices({
    config: options.providers
      ? { ...config, providers: { ...config.providers, ...options.providers } }
      : config,
    db,
    jobs,
    listen: listenFor(testDb),
    registry: createMemoryProviderRegistry({
      keyless: ["test"],
      languageModels: {
        ...options.models,
        ...(options.titleModel ? { "test:title": options.titleModel } : {}),
      },
    }),
    resolveTurn: options.realTurns
      ? undefined
      : () => {
          const turn = turns.shift();
          if (!turn) {
            throw new Error("no turn scripted for this agent pass");
          }
          return Promise.resolve(
            ok<Turn>({
              agent: null,
              model: turn.model,
              paidBy: null,
              proposeEdits: turn.proposeEdits,
              resolvedModel: "test:model",
              toolApproval: turn.toolApproval,
              tools: turn.tools,
            })
          );
        },
    tools: {
      ...(options.images ? { images: options.images.models } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox(db) } : {}),
      ...(options.skillFiles ? { skillFiles: options.skillFiles } : {}),
    },
  });
  await registerCoreJobs(jobs, services);
  const app = createApp({
    resolveSession: (request) => {
      const userId = request.headers.get(USER_HEADER);
      return Promise.resolve(userId ? { userId: userId as UserId } : null);
    },
    services,
  });

  return {
    close: async () => {
      await services.stop();
      await testDb.close();
    },
    db,
    jobs,
    nextTurn: (turn) => {
      turns.push(turn);
    },
    ownerId: owner.id,
    request: async (path, { as, json, ...init } = {}) =>
      await app.request(path, {
        ...init,
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        headers: {
          ...(json === undefined ? {} : { "content-type": "application/json" }),
          [USER_HEADER]: as ?? owner.id,
          ...(init.headers as Record<string, string> | undefined),
        },
      }),
    services,
  };
};

export interface SseEvent {
  readonly data: string;
  readonly id: number | null;
}

/** Parses SSE text into events (comments and blank lines dropped). */
export const parseSse = (text: string): SseEvent[] =>
  text
    .split("\n\n")
    .filter((block) => block.trim() !== "" && !block.startsWith(":"))
    .map((block) => {
      let id: number | null = null;
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) {
          id = Number(line.slice(4));
        } else if (line.startsWith("data: ")) {
          data = line.slice(6);
        }
      }
      return { data, id };
    });

/** Reads SSE events until `until` says stop (or the stream ends), then cancels. */
export const readEvents = async (
  response: Response,
  until: (events: readonly SseEvent[]) => boolean = () => false
): Promise<SseEvent[]> => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("no body");
  }
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: an SSE stream is read in order.
    const { done, value } = await reader.read();
    if (done) {
      return parseSse(text);
    }
    text += decoder.decode(value, { stream: true });
    const events = parseSse(text.slice(0, text.lastIndexOf("\n\n") + 2));
    if (until(events)) {
      await reader.cancel();
      return events;
    }
  }
};

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { createHashEmbeddingModel } from "@workspace/ai/rag/mock-embedding-model";
import { generated, textStream } from "@workspace/ai/testing/mock-models";
import type { AppConfig } from "@workspace/config/schema";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { FileRecord } from "@workspace/contract/schemas/files";
import type { LibraryItemDetail } from "@workspace/contract/schemas/library";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServerFromEnv, type Server } from "./server";
import { readEvents, testConfig, textParts } from "./testing/harness";

// The whole server, in process, the way `apps/web` boots it (038 "Done
// when"): an empty environment, so the embedded PGlite in a fresh data
// directory with migrations applied at boot, real auth, real jobs (pg-boss
// on PGlite), real storage on a temp volume, and mock models behind the
// provider registry. Nothing reaches the network.

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Better Auth's scrypt is deliberately slow; tests hash with SHA-256.
const fastHasher = {
  hash: (password: string) => Promise.resolve(sha256(password)),
  verify: ({ hash, password }: { hash: string; password: string }) =>
    Promise.resolve(sha256(password) === hash),
};

/** Streams for the chat model, one per call, in order; what each call was offered. */
const replies: (() => { stream: ReadableStream<LanguageModelV4StreamPart> })[] =
  [];
const calls: LanguageModelV4CallOptions[] = [];

const chatModel = new MockLanguageModelV4({
  // Titles are one `generateText` call.
  doGenerate: () =>
    Promise.resolve(generated([{ text: "Winter fruit", type: "text" }])),
  doStream: (options) => {
    calls.push(options);
    const next = replies.shift();
    return Promise.resolve(next ? next() : textStream("(unscripted)"));
  },
});

const config = (base: AppConfig): AppConfig => ({
  ...base,
  // Refs are set after parsing: the schema checks them against configured
  // providers, and the test provider lives only in the memory registry.
  embeddings: { ...base.embeddings, dimensions: 384, model: "test:hash" },
  models: { ...base.models, default: "test:chat" },
  storage: { driver: "local", path: "" },
});

let dataDir: string;
let server: Server;
let token = "";

const call = async (
  path: string,
  init: RequestInit & { readonly json?: unknown } = {}
): Promise<Response> => {
  const { json, ...rest } = init;
  return await server.app.request(path, {
    ...rest,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    headers: {
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
};

/** The body as `T`, after checking the status (the body says why when it's wrong). */
const jsonOf = async <T>(response: Response, status: number): Promise<T> => {
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
};

const waitFor = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 20_000
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling until a background job gets there.
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "server-e2e-"));
  const base = config(testConfig());
  server = await createServerFromEnv({
    config: {
      ...base,
      storage: { driver: "local", path: join(dataDir, "files") },
    },
    dataDir,
    env: {},
    jobPollingSeconds: 0.5,
    passwordHasher: fastHasher,
    registry: createMemoryProviderRegistry({
      embeddingModels: {
        "test:hash": createHashEmbeddingModel({ dimensions: 384 }),
      },
      keyless: ["test"],
      languageModels: { "test:chat": chatModel },
    }),
  });
}, 120_000);

afterAll(async () => {
  await server?.stop();
  await rm(dataDir, { force: true, recursive: true });
});

describe("the server from an empty environment", () => {
  let chat: Conversation;
  let file: FileRecord;

  it("boots on the embedded database, with sign-in", async () => {
    expect(server.problem).toBeNull();
    expect(server.db).not.toBeNull();
    expect(server.auth).not.toBeNull();
    expect(server.jobs).not.toBeNull();
    expect((await call("/api/conversations")).status).toBe(401);
    const publicConfig = await jsonOf<{ auth: { signup: string } }>(
      await call("/api/config"),
      200
    );
    expect(publicConfig.auth.signup).toBe("invite");
  });

  it("makes the first sign-up the admin", async () => {
    const signedUp = await call("/api/auth/sign-up/email", {
      json: {
        email: "ada@example.test",
        name: "Ada",
        password: "correct-horse-battery",
      },
      method: "POST",
    });
    expect(signedUp.status).toBe(200);
    token = signedUp.headers.get("set-auth-token") ?? "";
    expect(token).not.toBe("");
    const me = await jsonOf<{ user: { isAdmin: boolean } }>(
      await call("/api/me"),
      200
    );
    expect(me.user.isAdmin).toBe(true);
    const models = await jsonOf<{ available: boolean; selector: string }[]>(
      await call("/api/models"),
      200
    );
    expect(models).toContainEqual(
      expect.objectContaining({ available: true, selector: "test:chat" })
    );
  });

  it("creates a chat and streams a turn, resuming after a disconnect", async () => {
    chat = await jsonOf<Conversation>(
      await call("/api/conversations", { json: {}, method: "POST" }),
      201
    );
    // A reply the test feeds part by part, to drop the reader mid-answer.
    const feed: {
      sink?: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
    } = {};
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (controller) => {
        feed.sink = controller;
      },
    });
    const push = (...parts: LanguageModelV4StreamPart[]) => {
      for (const part of parts) {
        feed.sink?.enqueue(part);
      }
    };
    replies.push(() => ({ stream }));

    const created = await jsonOf<CreateRunOutput>(
      await call("/api/runs", {
        json: {
          conversationId: chat.id,
          input: {
            parentId: null,
            parts: [{ text: "When do kumquats ripen?", type: "text" }],
            type: "message",
          },
        },
        method: "POST",
      }),
      202
    );
    push(...textParts.start(), textParts.delta("In "));
    const first = await readEvents(await call(created.streamUrl), (events) =>
      events.some((event) => event.data.includes("In "))
    );
    const lastId = first.at(-1)?.id ?? 0;
    expect(lastId).toBeGreaterThan(0);

    // The tab closed; the run goes on without it.
    push(textParts.delta("winter."), textParts.textEnd(), textParts.finish());
    feed.sink?.close();
    await server.services?.executor.idle();

    const rest = await readEvents(
      await call(`${created.streamUrl}?cursor=${lastId}`)
    );
    expect(rest.at(-1)?.data).toBe("[DONE]");
    expect(rest.some((event) => event.data.includes("winter."))).toBe(true);
    expect(rest.every((event) => event.id === null || event.id > lastId)).toBe(
      true
    );

    const run = await jsonOf<{ state: { status: string } }>(
      await call(`/api/runs/${created.runId}`),
      200
    );
    expect(run.state.status).toBe("succeeded");
    // The title job runs in the background through pg-boss.
    const titled = await waitFor(
      async () =>
        await jsonOf<Conversation>(
          await call(`/api/conversations/${chat.id}`),
          200
        ),
      (conversation) => conversation.title !== null
    );
    expect(titled.title).toBe("Winter fruit");
  }, 60_000);

  it("uploads a file, indexes it in the background and finds it", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        ["Kumquats ripen in winter. Medlars are eaten bletted."],
        "fruit.md",
        {
          type: "text/markdown",
        }
      )
    );
    form.set("conversationId", chat.id);
    file = await jsonOf<FileRecord>(
      await call("/api/files", { body: form, method: "POST" }),
      201
    );
    const ready = await waitFor(
      async () =>
        await jsonOf<FileRecord>(await call(`/api/files/${file.id}`), 200),
      (record) => record.status.state === "ready"
    );
    expect(ready.status).toMatchObject({ embeddingModel: "test:hash" });

    const hits = await jsonOf<{ fileId: string }[]>(
      await call("/api/files/search", {
        json: { limit: 3, query: "kumquats ripen" },
        method: "POST",
      }),
      200
    );
    expect(hits[0]?.fileId).toBe(file.id);
  }, 60_000);

  it("serves the file as a download, signed or signed-in", async () => {
    const direct = await call(`/api/files/${file.id}/content`);
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-disposition")).toContain("attachment");
    expect(direct.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await direct.text()).toContain("Kumquats");

    const { url } = await jsonOf<{ url: string }>(
      await call(`/api/files/${file.id}/url`),
      200
    );
    const signed = new URL(url);
    const saved = token;
    token = "";
    const download = await call(`${signed.pathname}${signed.search}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(
      'filename="fruit.md"'
    );
    const tampered = await call(
      `${signed.pathname}${signed.search.replace("signature=", "signature=x")}`
    );
    expect(tampered.status).toBe(403);
    token = saved;
  });

  it("offers a plain chat file_search over its attachments", async () => {
    replies.push(() => textStream("They ripen in winter."));
    const created = await jsonOf<CreateRunOutput>(
      await call("/api/runs", {
        json: {
          conversationId: chat.id,
          input: {
            parentId: null,
            parts: [{ text: "What did my notes say?", type: "text" }],
            type: "message",
          },
        },
        method: "POST",
      }),
      202
    );
    await server.services?.executor.idle();
    const run = await jsonOf<{ state: { status: string } }>(
      await call(`/api/runs/${created.runId}`),
      200
    );
    expect(run.state.status).toBe("succeeded");
    const offered = (calls.at(-1)?.tools ?? []).map((tool) => tool.name);
    expect(offered).toContain("file_search");
  }, 30_000);

  it("runs a published library agent", async () => {
    const agent = await jsonOf<LibraryItemDetail>(
      await call("/api/library", {
        json: {
          definition: {
            instructions: "Answer like a pirate.",
            kind: "agent",
            model: "test:chat",
          },
          name: "Pirate",
        },
        method: "POST",
      }),
      201
    );
    expect(
      (
        await call(`/api/library/${agent.id}/versions`, {
          json: {},
          method: "POST",
        })
      ).status
    ).toBeLessThan(300);

    replies.push(() => textStream("Arr, winter it be."));
    const pirateChat = await jsonOf<Conversation>(
      await call("/api/conversations", { json: {}, method: "POST" }),
      201
    );
    const created = await jsonOf<CreateRunOutput>(
      await call("/api/runs", {
        json: {
          conversationId: pirateChat.id,
          input: {
            parentId: null,
            parts: [{ text: "Kumquats?", type: "text" }],
            type: "message",
          },
          target: { id: agent.id, type: "agent" },
        },
        method: "POST",
      }),
      202
    );
    await server.services?.executor.idle();
    const run = await jsonOf<{ state: { status: string } }>(
      await call(`/api/runs/${created.runId}`),
      200
    );
    expect(run.state.status).toBe("succeeded");
    const system = calls.at(-1)?.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain("pirate");
  }, 30_000);

  it("finds the chat by its words", async () => {
    const page = await jsonOf<{ items: { conversationId: string }[] }>(
      await call("/api/search/conversations?query=kumquats&limit=10"),
      200
    );
    expect(page.items.map((hit) => hit.conversationId)).toContain(chat.id);
  });
});

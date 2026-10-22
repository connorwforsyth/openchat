import type {
  LibraryItemId,
  RunId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { UserMessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  CreateRunOutput,
  Run,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { getSandboxForConversation } from "@workspace/db/queries/sandboxes";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { expectOk } from "@workspace/db/testing";
import { WORKSPACE_INSTRUCTIONS } from "@workspace/server/runs/sandbox";
import { createHarness, type Harness } from "@workspace/server/testing/harness";
import { err, ok } from "@workspace/shared/result";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJustBashFactory } from "../just-bash/provider";
import { createMemorySnapshotStore } from "../just-bash/snapshot-store";
import type { ProviderEntry, SandboxProviders } from "../providers";
import { createDockerLikeEntry, previewUrlFor } from "../testing/docker-like";
import { STATIC_PREVIEW_PORT } from "../tools/static-preview";
import { SANDBOX_TOOL_NAMES } from "../tools/tools";
import {
  createTurnSandboxSource,
  ensureWorkspace,
  providerForTurn,
} from "./turn-tools";

// Sandbox tools in agent turns, in process (ticket 041, PLAN.md §11 M1 steps
// 6–7): an agent with the just-bash sandbox runs commands, and its `edit`
// pauses the run with the proposed patch; one hunk accepted and one
// rejected leaves only the accepted one applied, and the rejection's comment
// reaches the model. The model is a mock; the sandbox is the real just-bash.

const usage = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: 10,
    total: 10,
  },
  outputTokens: { reasoning: undefined, text: 5, total: 5 },
};

const streamOf = (chunks: readonly unknown[]) => ({
  stream: simulateReadableStream({
    chunkDelayInMs: null,
    chunks: chunks as never[],
  }),
});

const toolCall = (toolName: string, input: unknown, toolCallId: string) =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { input: JSON.stringify(input), toolCallId, toolName, type: "tool-call" },
    {
      finishReason: { raw: "tool-calls", unified: "tool-calls" },
      type: "finish",
      usage,
    },
  ]);

const text = (value: string) =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { id: "t1", type: "text-start" },
    { delta: value, id: "t1", type: "text-delta" },
    { id: "t1", type: "text-end" },
    { finishReason: { raw: "stop", unified: "stop" }, type: "finish", usage },
  ]);

const justBash = (): ProviderEntry => ({
  factory: createJustBashFactory({ store: createMemorySnapshotStore() }),
  isolation: () => Promise.resolve(ok("simulated" as const)),
  limits: { cpu: 1, diskMb: 64, memoryMb: 256, network: false },
});

const definition: AgentDefinition = {
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "You work in the sandbox.",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "test:agent",
  parameters: {},
  sandboxProvider: "just-bash",
  skills: [],
  tools: [],
};

const SOURCE = [
  "const first = 1;",
  ...Array.from({ length: 10 }, (_, i) => `// line ${i + 1}`),
  "const second = 1;",
  "",
].join("\n");

let h: Harness;
let providers: SandboxProviders;
let model: MockLanguageModelV4;

beforeEach(async () => {
  providers = new Map([["just-bash", justBash()]]);
  model = new MockLanguageModelV4({
    doStream: [
      // Turn 1: a command, then the answer.
      toolCall(
        "bash",
        { command: "ls && echo hi > a.txt && cat a.txt" },
        "call-bash"
      ),
      text("It says hi."),
      // Turn 2: an edit touching two far-apart lines (two hunks).
      toolCall(
        "edit",
        {
          newString: "= 2;",
          oldString: "= 1;",
          path: "app.ts",
          replaceAll: true,
        },
        "call-edit"
      ),
      text("Applied what you accepted."),
    ],
  });
  h = await createHarness({
    models: { "test:agent": model },
    realTurns: true,
    sandbox: (db) =>
      createTurnSandboxSource({
        db,
        defaultProvider: "just-bash",
        providers,
      }),
  });
});

afterEach(() => h.close());

const json = async <T>(response: Response, status = 200): Promise<T> => {
  if (response.status !== status) {
    throw new Error(
      `expected ${status}, got ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

const publishedAgent = async (): Promise<RunTarget> => {
  const { item } = await createVersionedItem(h.db, "agent", {
    createdBy: h.ownerId,
    definition,
    name: "Sandboxer",
    owner: { id: h.ownerId, type: "user" },
  });
  expectOk(
    await publishDraft(h.db, "agent", item.id as LibraryItemId, {
      publishedBy: h.ownerId,
    })
  );
  return { id: item.id as LibraryItemId, type: "agent" };
};

const send = async (
  conversationId: string,
  target: RunTarget,
  prompt: string | UserMessagePart[],
  parentId: string | null,
  options?: { readonly sandbox: "auto" | "off" | "on" }
) =>
  json<CreateRunOutput>(
    await h.request("/api/runs", {
      json: {
        conversationId,
        input: {
          parentId,
          parts:
            typeof prompt === "string"
              ? [{ text: prompt, type: "text" }]
              : prompt,
          type: "message",
        },
        ...(options ? { options } : {}),
        target,
      },
      method: "POST",
    }),
    202
  );

const newChat = async () =>
  json<Conversation>(
    await h.request("/api/conversations", {
      json: { mode: "code" },
      method: "POST",
    }),
    201
  );

const MODEL: RunTarget = { model: "test:agent", type: "model" };

const getRun = async (runId: RunId) =>
  json<Run>(await h.request(`/api/runs/${runId}`));

/** The chat's live sandbox, as the panel would see it. */
const sandboxOf = async (conversationId: Conversation["id"]) => {
  const row = await getSandboxForConversation(h.db, conversationId);
  if (!row) {
    throw new Error("the chat has no sandbox");
  }
  const attached = await providers
    .get("just-bash")
    ?.factory.attach(row.id as SandboxId);
  if (!attached?.ok) {
    throw new Error("couldn't attach to the chat's sandbox");
  }
  return attached.value;
};

const readText = async (
  sandbox: Awaited<ReturnType<typeof sandboxOf>>,
  path: string
) => {
  const read = await sandbox.readFile(path);
  return read.ok ? new TextDecoder().decode(read.value) : null;
};

/** The tool result the model was sent on its `n`th call. */
const toolResultSeen = (n: number, toolCallId: string) =>
  model.doStreamCalls[n]?.prompt
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .find(
      (part) => part.type === "tool-result" && part.toolCallId === toolCallId
    );

describe("sandbox tools in agent turns", () => {
  it("runs commands, then applies only the accepted hunk of a reviewed edit", async () => {
    const agent = await publishedAgent();
    const chat = await json<Conversation>(
      await h.request("/api/conversations", {
        json: { mode: "code" },
        method: "POST",
      }),
      201
    );

    // Turn 1: bash runs in a just-bash sandbox the turn created for the chat.
    const first = await send(chat.id, agent, "say hi from a file", null);
    await h.services.executor.idle();
    const firstRun = await getRun(first.runId);
    expect(firstRun.state.status).toBe("succeeded");
    expect(toolResultSeen(1, "call-bash")).toMatchObject({
      output: {
        type: "json",
        value: { exitCode: 0, status: "ran", stdout: "hi\n" },
      },
    });
    const sandbox = await sandboxOf(chat.id);
    expect(await readText(sandbox, "a.txt")).toBe("hi\n");

    // Turn 2: an edit pauses the run with its patch, split into hunks.
    expectOk(await sandbox.writeFile("app.ts", SOURCE));
    const second = await send(
      chat.id,
      agent,
      "bump both constants",
      firstRun.assistantMessageId
    );
    await h.services.executor.idle();
    const paused = await getRun(second.runId);
    expect(paused.state.status).toBe("awaiting_approval");
    const [approval] =
      paused.state.status === "awaiting_approval" ? paused.state.approvals : [];
    expect(approval).toMatchObject({
      toolCallId: "call-edit",
      toolName: "edit",
    });
    const [edit] = approval?.edits ?? [];
    expect(edit?.path).toBe("app.ts");
    expect(edit?.hunks.map((hunk) => hunk.hunkId)).toEqual(["h1", "h2"]);
    expect(edit?.patch).toContain("+const first = 2;");
    // Nothing is written while it waits.
    expect(await readText(sandbox, "app.ts")).toBe(SOURCE);

    // Accept the first hunk, reject the second with a reason.
    const decided = await h.request(`/api/runs/${second.runId}/approvals`, {
      json: {
        decisions: [
          {
            decision: {
              comments: [],
              decision: "review",
              hunks: [
                { decision: "accept", hunkId: "h1" },
                {
                  comment: "second stays at 1",
                  decision: "reject",
                  hunkId: "h2",
                },
              ],
            },
            toolCallId: "call-edit",
          },
        ],
      },
      method: "POST",
    });
    expect(decided.status).toBe(200);
    await h.services.executor.idle();

    expect((await getRun(second.runId)).state.status).toBe("succeeded");
    expect(await readText(sandbox, "app.ts")).toBe(
      SOURCE.replace("const first = 1;", "const first = 2;")
    );
    // The model learns which hunks landed and why the other didn't.
    expect(toolResultSeen(3, "call-edit")).toMatchObject({
      output: {
        type: "json",
        value: {
          applied: ["h1"],
          feedback: expect.stringContaining("second stays at 1"),
          rejected: ["h2"],
          status: "changed",
        },
      },
    });
  });

  it("offers no tools for a request without a provider until a workspace is attached", async () => {
    const source = createTurnSandboxSource({
      db: h.db,
      defaultProvider: "just-bash",
      providers,
    });
    const chat = await json<Conversation>(
      await h.request("/api/conversations", {
        json: { mode: "code" },
        method: "POST",
      }),
      201
    );
    const run = {
      context: { type: "personal" as const },
      conversationId: chat.id,
      createdBy: h.ownerId,
      options: { sandbox: "auto" as const, webSearch: "auto" as const },
      runId: "00000000-0000-7000-8000-000000000001" as RunId,
      target: { model: "test:agent", type: "model" as const },
      userMessageId: "00000000-0000-7000-8000-000000000002" as never,
    };
    expect(
      await source({ requested: null, reviews: new Map(), run })
    ).toBeNull();
    const agentTurn = await source({
      requested: "just-bash",
      reviews: new Map(),
      run,
    });
    expect(Object.keys(agentTurn?.tools ?? {}).sort()).toEqual(
      [...SANDBOX_TOOL_NAMES].sort()
    );
    // Nothing starts until a tool needs it.
    expect(await getSandboxForConversation(h.db, chat.id)).toBeNull();
  });

  it("puts a port the agent previews on the chat's sandbox, for the panel", async () => {
    // just-bash can't serve ports; this one can, like a Docker sandbox.
    const inner = justBash();
    const withPreviews = (
      sandbox: Awaited<ReturnType<typeof inner.factory.attach>>
    ) =>
      sandbox.ok
        ? ok({
            ...sandbox.value,
            exposePort: (port: number) =>
              Promise.resolve(ok({ port, url: `http://preview.test:${port}` })),
          })
        : sandbox;
    const previewing: ProviderEntry = {
      ...inner,
      factory: {
        ...inner.factory,
        attach: async (id) => withPreviews(await inner.factory.attach(id)),
        create: async (spec) => withPreviews(await inner.factory.create(spec)),
      },
    };
    const source = createTurnSandboxSource({
      db: h.db,
      defaultProvider: "just-bash",
      providers: new Map([["just-bash", previewing]]),
    });
    const chat = await json<Conversation>(
      await h.request("/api/conversations", {
        json: { mode: "code" },
        method: "POST",
      }),
      201
    );
    const turn = await source({
      requested: "just-bash",
      reviews: new Map(),
      run: {
        context: { type: "personal" },
        conversationId: chat.id,
        createdBy: h.ownerId,
        options: { sandbox: "auto", webSearch: "auto" },
        runId: "00000000-0000-7000-8000-000000000003" as RunId,
        target: { model: "test:agent", type: "model" },
        userMessageId: "00000000-0000-7000-8000-000000000004" as never,
      },
    });
    const preview = turn?.tools.preview as unknown as {
      execute: (input: { port: number }, options: object) => Promise<unknown>;
    };
    expect(
      await preview.execute({ port: 5173 }, { messages: [], toolCallId: "p" })
    ).toEqual({
      port: 5173,
      status: "exposed",
      url: "http://preview.test:5173",
    });
    const row = await getSandboxForConversation(h.db, chat.id);
    expect(row?.previews).toEqual([
      { port: 5173, url: "http://preview.test:5173" },
    ]);
  });
});

const viewer = async () => ({
  principals: await loadPrincipals(h.db, h.ownerId),
  userId: h.ownerId,
});

/** The sandbox tools offered on the model's `n`th call (memory's are always there). */
const sandboxToolsSeen = (n: number) =>
  (model.doStreamCalls[n]?.tools ?? [])
    .map((each) => each.name)
    .filter((name) => (SANDBOX_TOOL_NAMES as readonly string[]).includes(name))
    .sort();

/** The model's system prompt on its `n`th call. */
const systemSeen = (n: number) =>
  model.doStreamCalls[n]?.prompt.find((message) => message.role === "system")
    ?.content;

describe("every plain chat has a workspace", () => {
  let script: ReturnType<typeof text>[] = [];

  beforeEach(async () => {
    await h.close();
    script = [];
    model = new MockLanguageModelV4({
      doStream: () => Promise.resolve(script.shift() ?? text("Done.")),
    });
    h = await createHarness({
      models: { "test:agent": model },
      realTurns: true,
      sandbox: (db) =>
        createTurnSandboxSource({
          db,
          defaultProvider: "just-bash",
          providers,
        }),
    });
  });

  it("offers the tools, and the first call creates the workspace", async () => {
    script = [
      toolCall("bash", { command: "echo hi > a.txt && cat a.txt" }, "call-1"),
    ];
    const chat = await newChat();
    const first = await send(chat.id, MODEL, "make a file", null);
    await h.services.executor.idle();

    expect((await getRun(first.runId)).state.status).toBe("succeeded");
    expect(sandboxToolsSeen(0)).toEqual([...SANDBOX_TOOL_NAMES].sort());
    expect(systemSeen(0)).toContain(WORKSPACE_INSTRUCTIONS);
    expect(systemSeen(0)).toContain("Never ask the user to run commands");
    expect(toolResultSeen(1, "call-1")).toMatchObject({
      output: { type: "json", value: { status: "ran", stdout: "hi\n" } },
    });
    const row = await getSandboxForConversation(h.db, chat.id);
    expect(row).toMatchObject({ provider: "just-bash", state: "ready" });
  });

  it("offers nothing when the composer turns the workspace off", async () => {
    const chat = await newChat();
    const first = await send(chat.id, MODEL, "just talk", null, {
      sandbox: "off",
    });
    await h.services.executor.idle();

    expect((await getRun(first.runId)).state.status).toBe("succeeded");
    expect(sandboxToolsSeen(0)).toEqual([]);
    expect(systemSeen(0) ?? "").not.toContain(WORKSPACE_INSTRUCTIONS);
    expect(await getSandboxForConversation(h.db, chat.id)).toBeNull();
  });

  it("reads @file mentions from the workspace into the turn", async () => {
    const chat = await newChat();
    const workspace = await ensureWorkspace(
      { db: h.db, defaultProvider: "just-bash", providers },
      await viewer(),
      chat.id,
      "just-bash"
    );
    if (!workspace.ok) {
      throw new Error("the workspace didn't start");
    }
    expectOk(await workspace.value.writeFile("notes.md", "# Notes\nship it"));

    await send(
      chat.id,
      MODEL,
      [
        { text: "what does @notes.md say?", type: "text" },
        { data: { path: "notes.md" }, name: "workspace-file", type: "data" },
        { data: { path: "missing.md" }, name: "workspace-file", type: "data" },
      ],
      null
    );
    await h.services.executor.idle();

    expect(systemSeen(0)).toContain(
      '<workspace-file path="notes.md">\n# Notes\nship it\n</workspace-file>'
    );
    expect(systemSeen(0)).toContain(
      '<workspace-file path="missing.md" omitted="true">No such file in the workspace.</workspace-file>'
    );
  });
});

/** A just-bash factory standing in for Docker, whose host is up or down. */
const fakeDocker = () => {
  const inner = justBash();
  const host: { up: boolean } = { up: true };
  const down = () =>
    Promise.resolve(
      err({ message: "the runner is down", type: "unavailable" as const })
    );
  const entry: ProviderEntry = {
    factory: {
      attach: (id) => (host.up ? inner.factory.attach(id) : down()),
      create: (spec) => (host.up ? inner.factory.create(spec) : down()),
      provider: "docker",
    },
    isolation: () =>
      host.up ? Promise.resolve(ok("container" as const)) : down(),
    limits: inner.limits,
  };
  return { entry, host };
};

describe("ensureWorkspace", () => {
  it("recovers from a start that failed, without a Reset", async () => {
    const inner = justBash();
    let failures = 1;
    const flaky: ProviderEntry = {
      ...inner,
      factory: {
        ...inner.factory,
        create: (spec) => {
          if (failures > 0) {
            failures -= 1;
            return Promise.resolve(
              err({ message: "no room", type: "unavailable" as const })
            );
          }
          return inner.factory.create(spec);
        },
      },
    };
    const deps = {
      db: h.db,
      defaultProvider: "just-bash" as const,
      providers: new Map([["just-bash", flaky]]) as SandboxProviders,
    };
    const chat = await newChat();

    const first = await ensureWorkspace(
      deps,
      await viewer(),
      chat.id,
      "just-bash"
    );
    expect(first.ok).toBe(false);
    const failed = await getSandboxForConversation(h.db, chat.id);
    expect(failed?.state).toBe("failed");

    const second = await ensureWorkspace(
      deps,
      await viewer(),
      chat.id,
      "just-bash"
    );
    expect(second.ok).toBe(true);
    const row = await getSandboxForConversation(h.db, chat.id);
    expect(row).toMatchObject({ id: failed?.id, state: "ready" });
  });

  it("starts a just-bash workspace again when the process lost it", async () => {
    const chat = await newChat();
    const deps = {
      db: h.db,
      defaultProvider: "just-bash" as const,
      providers,
    };
    expect(
      (await ensureWorkspace(deps, await viewer(), chat.id, "just-bash")).ok
    ).toBe(true);
    const before = await getSandboxForConversation(h.db, chat.id);

    // A restart with an in-memory store: the row says ready, nothing's there.
    const restarted = {
      ...deps,
      providers: new Map([["just-bash", justBash()]]) as SandboxProviders,
    };
    const again = await ensureWorkspace(
      restarted,
      await viewer(),
      chat.id,
      "just-bash"
    );
    expect(again.ok && again.value.id).toBe(before?.id);
  });

  it("falls back to just-bash for a new workspace when Docker is down", async () => {
    const docker = fakeDocker();
    docker.host.up = false;
    const deps = {
      db: h.db,
      defaultProvider: "docker" as const,
      providers: new Map([
        ["docker", docker.entry],
        ["just-bash", justBash()],
      ]) as SandboxProviders,
    };
    const chat = await newChat();
    const workspace = await ensureWorkspace(
      deps,
      await viewer(),
      chat.id,
      "docker"
    );
    expect(workspace.ok && workspace.value.provider).toBe("just-bash");
    expect(await getSandboxForConversation(h.db, chat.id)).toMatchObject({
      provider: "just-bash",
      state: "ready",
    });
  });

  it("keeps an existing Docker workspace, and its files, through an outage", async () => {
    const docker = fakeDocker();
    const deps = {
      db: h.db,
      defaultProvider: "docker" as const,
      providers: new Map([
        ["docker", docker.entry],
        ["just-bash", justBash()],
      ]) as SandboxProviders,
    };
    const chat = await newChat();
    const first = await ensureWorkspace(
      deps,
      await viewer(),
      chat.id,
      "docker"
    );
    if (!first.ok) {
      throw new Error("the workspace didn't start");
    }
    expectOk(await first.value.writeFile("keep.txt", "kept"));

    docker.host.up = false;
    const during = await ensureWorkspace(
      deps,
      await viewer(),
      chat.id,
      "docker"
    );
    expect(during).toEqual({
      error: { message: "the runner is down", type: "unavailable" },
      ok: false,
    });
    expect(await getSandboxForConversation(h.db, chat.id)).toMatchObject({
      id: first.value.id,
      provider: "docker",
      state: "ready",
    });

    docker.host.up = true;
    const after = await ensureWorkspace(
      deps,
      await viewer(),
      chat.id,
      "docker"
    );
    if (!after.ok) {
      throw new Error("the workspace didn't come back");
    }
    expect(after.value.id).toBe(first.value.id);
    const kept = await after.value.readFile("keep.txt");
    expect(kept.ok && new TextDecoder().decode(kept.value)).toBe("kept");
  });
});

describe("providerForTurn", () => {
  it("uses the requested provider, falling back to just-bash", () => {
    const deps = {
      defaultProvider: "just-bash" as const,
      providers: new Map([["just-bash", justBash()]]) as SandboxProviders,
    };
    expect(providerForTurn(deps, "just-bash")).toBe("just-bash");
    expect(providerForTurn(deps, "docker")).toBe("just-bash");
    expect(providerForTurn(deps, "default")).toBe("just-bash");
    expect(providerForTurn(deps, null)).toBeNull();
    expect(
      providerForTurn({ defaultProvider: null, providers: new Map() }, "docker")
    ).toBeNull();
  });
});

describe("static pages (067)", () => {
  const dockerTurn = async () => {
    const docker = createDockerLikeEntry();
    const deps = {
      db: h.db,
      defaultProvider: "docker" as const,
      providers: new Map([["docker", docker.entry]]) as SandboxProviders,
      sleep: () => Promise.resolve(),
    };
    const chat = await newChat();
    const turn = await createTurnSandboxSource(deps)({
      requested: "default",
      reviews: new Map(),
      run: {
        context: { type: "personal" },
        conversationId: chat.id,
        createdBy: h.ownerId,
        options: { sandbox: "auto", webSearch: "auto" },
        runId: "00000000-0000-7000-8000-000000000005" as RunId,
        target: MODEL,
        userMessageId: "00000000-0000-7000-8000-000000000006" as never,
      },
    });
    const call = (name: string, input: unknown) => {
      const tool = turn?.tools[name] as unknown as {
        execute: (input: unknown, options: object) => Promise<unknown>;
      };
      return tool.execute(input, { messages: [], toolCallId: name });
    };
    return { call, chat, deps, host: docker.host };
  };

  const started = (commands: readonly string[]) =>
    commands.filter((command) => command.startsWith("nohup node"));

  it("previews a page the agent writes, without a server of its own", async () => {
    const { call, chat, host } = await dockerTurn();
    await call("write", { content: "body {}", path: "style.css" });
    expect(started(host.commands)).toEqual([]);

    expect(
      await call("write", { content: "<h1>hi</h1>", path: "index.html" })
    ).toMatchObject({ status: "changed" });
    const row = await getSandboxForConversation(h.db, chat.id);
    expect(row?.previews).toEqual([
      {
        port: STATIC_PREVIEW_PORT,
        url: previewUrlFor(row?.id as SandboxId, STATIC_PREVIEW_PORT),
      },
    ]);

    await call("edit", {
      newString: "hello",
      oldString: "hi",
      path: "index.html",
    });
    expect(started(host.commands)).toHaveLength(1);
  });

  it("keeps the write when the preview fails", async () => {
    const { call, chat, host } = await dockerTurn();
    host.failExpose = true;
    expect(
      await call("write", { content: "<h1>hi</h1>", path: "index.html" })
    ).toMatchObject({ status: "changed" });
    expect((await getSandboxForConversation(h.db, chat.id))?.previews).toEqual(
      []
    );
  });

  it("exposes the chat's previews again when the workspace is attached", async () => {
    const { call, chat, deps, host } = await dockerTurn();
    await call("write", { content: "<h1>hi</h1>", path: "index.html" });
    const row = await getSandboxForConversation(h.db, chat.id);
    if (!row) {
      throw new Error("no workspace");
    }
    // The runner restarts and the idle stop ended the server.
    host.exposed.clear();
    host.listening.clear();
    expect(
      (await ensureWorkspace(deps, await viewer(), chat.id, "docker")).ok
    ).toBe(true);
    expect([...(host.exposed.get(row.id) ?? [])]).toEqual([
      STATIC_PREVIEW_PORT,
    ]);
    expect(started(host.commands)).toHaveLength(2);
  });
});

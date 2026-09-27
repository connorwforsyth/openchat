import type {
  LibraryItemId,
  RunId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
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
import { expectOk } from "@workspace/db/testing";
import { createHarness, type Harness } from "@workspace/server/testing/harness";
import { ok } from "@workspace/shared/result";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJustBashFactory } from "../just-bash/provider";
import { createMemorySnapshotStore } from "../just-bash/snapshot-store";
import type { ProviderEntry, SandboxProviders } from "../providers";
import { SANDBOX_TOOL_NAMES } from "../tools/tools";
import { createTurnSandboxSource, providerForTurn } from "./turn-tools";

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
  prompt: string,
  parentId: string | null
) =>
  json<CreateRunOutput>(
    await h.request("/api/runs", {
      json: {
        conversationId,
        input: {
          parentId,
          parts: [{ text: prompt, type: "text" }],
          type: "message",
        },
        target,
      },
      method: "POST",
    }),
    202
  );

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
      await h.request("/api/conversations", { json: {}, method: "POST" }),
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

  it("gives a plain chat no sandbox tools until one is attached", async () => {
    const source = createTurnSandboxSource({
      db: h.db,
      defaultProvider: "just-bash",
      providers,
    });
    const chat = await json<Conversation>(
      await h.request("/api/conversations", { json: {}, method: "POST" }),
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

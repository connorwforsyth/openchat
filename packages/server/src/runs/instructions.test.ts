import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { textStream } from "@workspace/ai/testing/mock-models";
import type { AppConfig } from "@workspace/config/schema";
import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { UserMessagePart } from "@workspace/contract/schemas/message-parts";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { setMemoryMode, writeMemory } from "@workspace/db/queries/memory";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { err, ok } from "@workspace/shared/result";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../app";
import { createServices } from "../services";
import { testConfig, USER_HEADER } from "../testing/harness";
import type { SandboxToolSource, WorkspaceRead } from "./sandbox";

// The system prompt a model receives, pinned per turn type (ticket 079).
// Each case goes through the production wiring (`createServices`: the turn
// resolver wrapped by memory, then the executor and `runAgent`) and
// snapshots the system message the mock model was sent. A change to the
// snapshot file is a change to what every model is told, so it needs a
// reason in the commit that makes it.

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
}, 60_000);
afterAll(() => testDb.close());

const encoder = new TextEncoder();

/** The chat's workspace as `@file` mentions read it. */
const FILES: Readonly<Record<string, Uint8Array | string>> = {
  "big.txt": "x".repeat(40_000),
  "logo.png": new Uint8Array([0x89, 0x50, 0xff, 0xfe]),
  "notes.md": "# Notes\nship it on $1 {{friday}}\n",
  'odd"<name>&.txt': "quoted",
};

const readFile: WorkspaceRead = (path) => {
  if (path === "locked.txt") {
    return Promise.resolve(
      err({ message: "the sandbox is stopped", type: "unavailable" })
    );
  }
  const file = FILES[path];
  if (file === undefined) {
    return Promise.resolve(err({ type: "not_found" }));
  }
  return Promise.resolve(
    ok(typeof file === "string" ? encoder.encode(file) : file)
  );
};

/** A workspace with one tool: enough for the turn to count as having one. */
const workspace: SandboxToolSource = () =>
  Promise.resolve({
    proposeEdits: () => Promise.resolve(undefined),
    provider: "just-bash",
    readFile,
    tools: {
      bash: tool({
        description: "Run a command.",
        execute: () => Promise.resolve({ status: "ran" }),
        inputSchema: z.object({ command: z.string() }),
      }),
    },
  });

const agentDefinition = (instructions: string): AgentDefinition => ({
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions,
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "test:chat",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
});

const MODEL: RunTarget = { model: "test:chat", type: "model" };

const mention = (path: string): UserMessagePart => ({
  data: { path },
  name: "workspace-file",
  type: "data",
});

interface TurnCase {
  /** Instructions of a published agent the turn runs; a plain chat without. */
  readonly agent?: string;
  /** `features.memory`, with the user's file as it is when the turn starts. */
  readonly memory?: {
    readonly content: string;
    readonly maxChars?: number;
    readonly mode?: "auto" | "propose";
  };
  readonly mentions?: readonly string[];
  readonly workspace?: boolean;
}

const configFor = (turn: TurnCase): AppConfig => {
  const config = testConfig();
  return {
    ...config,
    features: { ...config.features, memory: turn.memory !== undefined },
    limits: {
      ...config.limits,
      memoryMaxChars: turn.memory?.maxChars ?? config.limits.memoryMaxChars,
    },
  };
};

const publishedAgent = async (
  ownerId: UserId,
  instructions: string
): Promise<RunTarget> => {
  const { item } = await createVersionedItem(testDb.db, "agent", {
    createdBy: ownerId,
    definition: agentDefinition(instructions),
    name: "Pinned",
    owner: { id: ownerId, type: "user" },
  });
  const id = item.id as LibraryItemId;
  expectOk(
    await publishDraft(testDb.db, "agent", id, { publishedBy: ownerId })
  );
  return { id, type: "agent" };
};

/** Runs one turn as a fresh user and returns the system message the model got, `null` for none. */
const systemPromptOf = async (turn: TurnCase): Promise<string | null> => {
  const { db } = testDb;
  const user = await seedUser(db);
  await seedOrg(db, user.id, { isPersonal: true });
  if (turn.memory) {
    expectOk(
      await writeMemory(db, {
        content: turn.memory.content,
        source: { type: "user" },
        userId: user.id,
      })
    );
    await setMemoryMode(db, user.id, turn.memory.mode ?? "auto");
  }
  const model = new MockLanguageModelV4({
    doStream: () => Promise.resolve(textStream("Done.")),
  });
  const services = createServices({
    config: configFor(turn),
    db,
    jobs: null,
    registry: createMemoryProviderRegistry({
      keyless: ["test"],
      languageModels: { "test:chat": model },
    }),
    tools: turn.workspace ? { sandbox: workspace } : undefined,
  });
  const app = createApp({
    resolveSession: (request) => {
      const userId = request.headers.get(USER_HEADER);
      return Promise.resolve(userId ? { userId: userId as UserId } : null);
    },
    services,
  });
  const post = (path: string, json: unknown) =>
    app.request(path, {
      body: JSON.stringify(json),
      headers: { "content-type": "application/json", [USER_HEADER]: user.id },
      method: "POST",
    });
  try {
    const chat = (await (
      await post("/api/conversations", {})
    ).json()) as Conversation;
    const response = await post("/api/runs", {
      conversationId: chat.id,
      input: {
        parentId: null,
        parts: [
          { text: "hello", type: "text" },
          ...(turn.mentions ?? []).map(mention),
        ],
        type: "message",
      },
      target:
        turn.agent === undefined
          ? MODEL
          : await publishedAgent(user.id, turn.agent),
    });
    if (response.status !== 202) {
      throw new Error(`expected 202, got ${response.status}`);
    }
    await services.executor.idle();
    const [call] = model.doStreamCalls;
    if (!call) {
      throw new Error("the model was never called");
    }
    const system = call.prompt.filter((message) => message.role === "system");
    if (system.length > 1) {
      throw new Error("the model got more than one system message");
    }
    return system[0]?.content ?? null;
  } finally {
    await services.stop();
  }
};

const MEMORY = "- Prefers pnpm\n- Works in Melbourne time";
const AGENT = "You are a release manager. Answer in one paragraph.";

describe("the system prompt, by turn type", () => {
  it("plain chat", async () => {
    expect(await systemPromptOf({})).toMatchSnapshot();
  });

  it("chat with workspace", async () => {
    expect(await systemPromptOf({ workspace: true })).toMatchSnapshot();
  });

  it("agent", async () => {
    expect(await systemPromptOf({ agent: AGENT })).toMatchSnapshot();
  });

  it("agent with memory", async () => {
    expect(
      await systemPromptOf({ agent: AGENT, memory: { content: MEMORY } })
    ).toMatchSnapshot();
  });

  it("chat with mentions", async () => {
    expect(
      await systemPromptOf({
        mentions: [
          "notes.md",
          "missing.md",
          "big.txt",
          "logo.png",
          'odd"<name>&.txt',
          "locked.txt",
        ],
        workspace: true,
      })
    ).toMatchSnapshot();
  });
});

describe("the system prompt, where the layers meet", () => {
  it("plain chat with an empty memory file", async () => {
    expect(await systemPromptOf({ memory: { content: "" } })).toMatchSnapshot();
  });

  it("chat with workspace, mentions and a memory file over its cap, in propose mode", async () => {
    expect(
      await systemPromptOf({
        memory: {
          content: Array.from(
            { length: 40 },
            (_, line) => `- entry ${line + 1} of the memory file`
          ).join("\n"),
          maxChars: 500,
          mode: "propose",
        },
        mentions: ["notes.md"],
        workspace: true,
      })
    ).toMatchSnapshot();
  });

  it("chat with a mention and the workspace off", async () => {
    expect(await systemPromptOf({ mentions: ["notes.md"] })).toMatchSnapshot();
  });

  it("agent with mentions", async () => {
    expect(
      await systemPromptOf({
        agent: AGENT,
        mentions: ["notes.md"],
        workspace: true,
      })
    ).toMatchSnapshot();
  });

  it("agent whose instructions have space around them, with and without memory", async () => {
    const padded = `\n  ${AGENT}\n\n`;
    expect(await systemPromptOf({ agent: padded })).toMatchSnapshot("alone");
    expect(
      await systemPromptOf({ agent: padded, memory: { content: MEMORY } })
    ).toMatchSnapshot("with memory");
    expect(
      await systemPromptOf({
        agent: padded,
        memory: { content: MEMORY },
        mentions: ["notes.md"],
        workspace: true,
      })
    ).toMatchSnapshot("with mentions and memory");
  });

  it("agent with no instructions", async () => {
    expect(await systemPromptOf({ agent: "" })).toMatchSnapshot("alone");
    expect(
      await systemPromptOf({ agent: "", mentions: ["notes.md"] })
    ).toMatchSnapshot("with a mention");
    expect(
      await systemPromptOf({ agent: "  ", memory: { content: MEMORY } })
    ).toMatchSnapshot("blank, with memory");
  });
});

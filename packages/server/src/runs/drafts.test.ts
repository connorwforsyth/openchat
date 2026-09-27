import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { textStream } from "@workspace/ai/testing/mock-models";
import type {
  LibraryItemId,
  LibraryVersionId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type {
  CreateRunOutput,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import { upsertGrant } from "@workspace/db/queries/grants";
import {
  createVersionedItem,
  publishDraft,
  updateDraft,
} from "@workspace/db/queries/library";
import { getRun } from "@workspace/db/queries/runs";
import { expectOk, seedOrg, seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { testChatJobHandlers } from "../jobs/test-chats";
import { createHarness, type Harness, testConfig } from "../testing/harness";
import { runStartFromRow } from "./state";
import { createTurnResolver } from "./turn";

// The builder's test chat (ticket 033): editors run an agent's draft, and
// see an edit in the very next turn; nobody else can run it; the chat stays
// out of the history and is cleaned up later. The model is a mock that
// keeps every prompt it was sent.

let h: Harness;
let agentModel: MockLanguageModelV4;

beforeEach(async () => {
  agentModel = new MockLanguageModelV4({
    doStream: () => Promise.resolve(textStream("Aye")),
  });
  h = await createHarness({
    models: { "test:agent": agentModel },
    realTurns: true,
  });
});

afterEach(() => h.close());

const definition: AgentDefinition = {
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "Answer like a pirate.",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "test:agent",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
};

const someone = async (): Promise<UserId> => {
  const row = await seedUser(h.db);
  await seedOrg(h.db, row.id, { isPersonal: true });
  return row.id;
};

/** An agent the owner is still building: a draft, never published. */
const draftAgent = async () => {
  const { draft, item } = await createVersionedItem(h.db, "agent", {
    createdBy: h.ownerId,
    definition,
    name: "Pirate",
    owner: { id: h.ownerId, type: "user" },
  });
  return {
    id: item.id as LibraryItemId,
    target: {
      id: item.id as LibraryItemId,
      type: "agent",
      versionId: draft.id as LibraryVersionId,
    } satisfies RunTarget,
  };
};

const grant = async (
  resource: { resourceId: string; resourceType: "agent" | "conversation" },
  user: UserId,
  permission: "use" | "edit" | "editor"
) =>
  expectOk(
    await upsertGrant(h.db, {
      grantedBy: h.ownerId,
      permission,
      principal: { id: user, type: "user" },
      resource: resource as never,
    })
  );

const createChat = async (defaultTarget?: RunTarget) => {
  const response = await h.request("/api/conversations", {
    json: defaultTarget ? { defaultTarget, title: "Agent test" } : {},
    method: "POST",
  });
  if (response.status !== 201) {
    throw new Error(`expected 201, got ${response.status}`);
  }
  return (await response.json()) as Conversation;
};

const send = (
  conversationId: string,
  target: RunTarget,
  options: { readonly as?: UserId; readonly text?: string } = {}
) =>
  h.request("/api/runs", {
    as: options.as,
    json: {
      conversationId,
      input: {
        parentId: null,
        parts: [{ text: options.text ?? "hello", type: "text" }],
        type: "message",
      },
      target,
    },
    method: "POST",
  });

/** What the model was told on its `n`th call, system prompt included. */
const promptOf = (n: number) =>
  JSON.stringify(agentModel.doStreamCalls[n]?.prompt ?? null);

describe("running a draft", () => {
  it("answers with the draft's instructions, and an edit shows up in the next turn", async () => {
    const agent = await draftAgent();
    const chat = await createChat(agent.target);

    const first = await send(chat.id, agent.target);
    expect(first.status).toBe(202);
    await h.services.executor.idle();
    expect(promptOf(0)).toContain("Answer like a pirate.");
    const { runId } = (await first.json()) as CreateRunOutput;
    const run = expectOk(await getRun(h.db, runId as RunId));
    expect(run.agentDraft).toBe(true);
    expect(run.status).toBe("succeeded");

    // No publish in between: the draft is read as the run starts.
    expectOk(
      await updateDraft(h.db, "agent", agent.id, {
        ...definition,
        instructions: "Answer like a poet.",
      })
    );
    expect((await send(chat.id, agent.target)).status).toBe(202);
    await h.services.executor.idle();
    expect(promptOf(1)).toContain("Answer like a poet.");
    expect(promptOf(1)).not.toContain("pirate");
  });

  it("isn't recorded as a draft run once the version is published", async () => {
    const agent = await draftAgent();
    const { version } = expectOk(
      await publishDraft(h.db, "agent", agent.id, { publishedBy: h.ownerId })
    );
    // The pinned id is now version 1, not the draft.
    expect(version.id).toBe(agent.target.versionId);
    const chat = await createChat();
    const response = await send(chat.id, agent.target);
    expect(response.status).toBe(202);
    const { runId } = (await response.json()) as CreateRunOutput;
    await h.services.executor.idle();
    const run = expectOk(await getRun(h.db, runId as RunId));
    expect(run).toMatchObject({ agentDraft: false, status: "succeeded" });
  });

  it("is NOT_FOUND to someone who can only use the agent", async () => {
    const agent = await draftAgent();
    const chat = await createChat();
    const bob = await someone();
    await grant(
      { resourceId: chat.id, resourceType: "conversation" },
      bob,
      "editor"
    );
    await grant({ resourceId: agent.id, resourceType: "agent" }, bob, "use");

    expect((await send(chat.id, agent.target, { as: bob })).status).toBe(404);
    expect(agentModel.doStreamCalls).toHaveLength(0);

    await grant({ resourceId: agent.id, resourceType: "agent" }, bob, "edit");
    expect((await send(chat.id, agent.target, { as: bob })).status).toBe(202);
    await h.services.executor.idle();
    expect(promptOf(0)).toContain("Answer like a pirate.");
  });

  it("won't start a queued draft run once edit access is gone", async () => {
    const agent = await draftAgent();
    const chat = await createChat();
    const bob = await someone();
    await grant(
      { resourceId: chat.id, resourceType: "conversation" },
      bob,
      "editor"
    );
    await grant({ resourceId: agent.id, resourceType: "agent" }, bob, "edit");
    const response = await send(chat.id, agent.target, { as: bob });
    const { runId } = (await response.json()) as CreateRunOutput;
    await h.services.executor.idle();
    const run = runStartFromRow(expectOk(await getRun(h.db, runId as RunId)));

    await grant({ resourceId: agent.id, resourceType: "agent" }, bob, "use");
    const resolve = createTurnResolver({
      config: testConfig(),
      db: h.db,
      keyStore: createMemoryKeyStore([]),
      registry: createMemoryProviderRegistry({
        keyless: ["test"],
        languageModels: { "test:agent": agentModel },
      }),
    });
    const turn = await resolve(run, {
      state: { facts: {}, history: [], input: "" },
    });
    expect(turn).toMatchObject({
      error: { code: "internal", message: "You can't run that agent's draft." },
      ok: false,
    });
  });
});

describe("draft or published (033 with 032)", () => {
  it("lets a use-only user run the published agent but not its draft", async () => {
    const agent = await draftAgent();
    const { draft, version } = expectOk(
      await publishDraft(h.db, "agent", agent.id, { publishedBy: h.ownerId })
    );
    expectOk(
      await updateDraft(h.db, "agent", agent.id, {
        ...definition,
        instructions: "Answer like a poet.",
      })
    );
    const latest: RunTarget = { id: agent.id, type: "agent" };
    const published: RunTarget = { ...latest, versionId: version.id };
    const pinnedDraft: RunTarget = { ...latest, versionId: draft.id };
    const chat = await createChat();
    const bob = await someone();
    await grant(
      { resourceId: chat.id, resourceType: "conversation" },
      bob,
      "editor"
    );
    await grant({ resourceId: agent.id, resourceType: "agent" }, bob, "use");

    expect((await send(chat.id, latest, { as: bob })).status).toBe(202);
    await h.services.executor.idle();
    expect((await send(chat.id, published, { as: bob })).status).toBe(202);
    await h.services.executor.idle();
    expect((await send(chat.id, pinnedDraft, { as: bob })).status).toBe(404);
    expect(agentModel.doStreamCalls).toHaveLength(2);
    expect(promptOf(0)).toContain("Answer like a pirate.");
    expect(promptOf(1)).toContain("Answer like a pirate.");

    // An editor runs the draft, and gets what's being edited.
    await grant({ resourceId: agent.id, resourceType: "agent" }, bob, "edit");
    const response = await send(chat.id, pinnedDraft, { as: bob });
    expect(response.status).toBe(202);
    await h.services.executor.idle();
    expect(promptOf(2)).toContain("Answer like a poet.");
    const { runId } = (await response.json()) as CreateRunOutput;
    expect(expectOk(await getRun(h.db, runId as RunId)).agentDraft).toBe(true);
  });
});

describe("test chats", () => {
  it("stay out of the chat list", async () => {
    const agent = await draftAgent();
    const ordinary = await createChat();
    const test = await createChat(agent.target);
    expect((await send(test.id, agent.target)).status).toBe(202);
    await h.services.executor.idle();

    const listed = await h.request("/api/conversations");
    const { items } = (await listed.json()) as {
      items: readonly Conversation[];
    };
    expect(items.map((item) => item.id)).toEqual([ordinary.id]);
    // The builder still opens it by id.
    expect((await h.request(`/api/conversations/${test.id}`)).status).toBe(200);
  });

  it("are deleted by the cleanup job once idle", async () => {
    const agent = await draftAgent();
    const ordinary = await createChat();
    const test = await createChat(agent.target);
    const prune = (hoursLater: number) => {
      const handler = testChatJobHandlers({
        db: h.db,
        now: () => new Date(Date.now() + hoursLater * 3_600_000),
      })["testChat.prune"];
      if (!handler) {
        throw new Error("no testChat.prune handler");
      }
      // The job's data is `{}`; nothing else on it is read.
      return handler({ data: {} } as never, new AbortController().signal);
    };

    expect(await prune(1)).toEqual({ ok: true, value: { deleted: 0 } });
    expect(await prune(25)).toEqual({ ok: true, value: { deleted: 1 } });
    expect((await h.request(`/api/conversations/${test.id}`)).status).toBe(404);
    expect((await h.request(`/api/conversations/${ordinary.id}`)).status).toBe(
      200
    );
  });
});

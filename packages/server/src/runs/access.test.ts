import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { RunId, UserId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type {
  CreateRunOutput,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import { deleteGrant, upsertGrant } from "@workspace/db/queries/grants";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { getRun } from "@workspace/db/queries/runs";
import { expectOk, seedOrg, seedUser } from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createHarness, type Harness, testConfig } from "../testing/harness";
import { createTurnResolver } from "./turn";

// Who may start a run (ticket 032): an editor of the chat (D25), with an
// agent they may `use` (D13). A viewer follows along; nobody runs an agent
// by knowing its id.

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => h.close());

const definition: AgentDefinition = {
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "Be brief.",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "test:model",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
};

/** A user with a personal space, as sign-up leaves them. */
const someone = async (): Promise<UserId> => {
  const row = await seedUser(h.db);
  await seedOrg(h.db, row.id, { isPersonal: true });
  return row.id;
};

/** An agent `owner` keeps in their own library, with one published version. */
const privateAgent = async (owner: UserId) => {
  const { item } = await createVersionedItem(h.db, "agent", {
    createdBy: owner,
    definition,
    name: "Reviewer",
    owner: { id: owner, type: "user" },
  });
  const { version } = expectOk(
    await publishDraft(h.db, "agent", item.id, { publishedBy: owner })
  );
  return { id: item.id, versionId: version.id };
};

const share = async (
  grantedBy: UserId,
  resource: { resourceId: string; resourceType: "agent" | "conversation" },
  user: UserId,
  permission: "use" | "edit" | "viewer" | "editor"
) =>
  expectOk(
    await upsertGrant(h.db, {
      grantedBy,
      permission,
      principal: { id: user, type: "user" },
      resource: resource as never,
    })
  );

const newConversation = async () => {
  const response = await h.request("/api/conversations", {
    json: {},
    method: "POST",
  });
  if (response.status !== 201) {
    throw new Error(`expected 201, got ${response.status}`);
  }
  return (await response.json()) as Conversation;
};

const send = (conversationId: string, target: RunTarget, as?: UserId) =>
  h.request("/api/runs", {
    as,
    json: {
      conversationId,
      input: {
        parentId: null,
        parts: [{ text: "hello", type: "text" }],
        type: "message",
      },
      target,
    },
    method: "POST",
  });

const model: RunTarget = { model: "test:model", type: "model" };

const messagesIn = async (conversationId: string) => {
  const response = await h.request(`/api/conversations/${conversationId}/path`);
  return ((await response.json()) as BranchPath).messages;
};

describe("POST /api/runs access", () => {
  it("lets an editor prompt, a viewer only read, and hides the chat from anyone else", async () => {
    const chat = await newConversation();
    const bob = await someone();
    const ref = { resourceId: chat.id, resourceType: "conversation" as const };

    expect((await send(chat.id, model, bob)).status).toBe(404);
    await share(h.ownerId, ref, bob, "viewer");
    expect((await send(chat.id, model, bob)).status).toBe(403);
    expect(await messagesIn(chat.id)).toEqual([]);

    await share(h.ownerId, ref, bob, "editor");
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Hi") }),
    });
    expect((await send(chat.id, model, bob)).status).toBe(202);
  });

  it("won't run an agent the caller can't use, latest or pinned", async () => {
    const chat = await newConversation();
    const carol = await someone();
    const agent = await privateAgent(carol);
    const latest: RunTarget = { id: agent.id, type: "agent" };
    const pinned: RunTarget = { ...latest, versionId: agent.versionId };

    expect((await send(chat.id, latest)).status).toBe(404);
    expect((await send(chat.id, pinned)).status).toBe(404);
    // Refused before anything was stored.
    expect(await messagesIn(chat.id)).toEqual([]);

    await share(
      carol,
      { resourceId: agent.id, resourceType: "agent" },
      h.ownerId,
      "use"
    );
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Hi") }),
    });
    expect((await send(chat.id, pinned)).status).toBe(202);
  });

  it("won't run the chat's default agent for someone who can't use it", async () => {
    const carol = await someone();
    const agent = await privateAgent(carol);
    const response = await h.request("/api/conversations", {
      as: carol,
      json: { defaultTarget: { id: agent.id, type: "agent" } },
      method: "POST",
    });
    const chat = (await response.json()) as Conversation;
    await share(
      carol,
      { resourceId: chat.id, resourceType: "conversation" },
      h.ownerId,
      "editor"
    );
    const untargeted = await h.request("/api/runs", {
      json: {
        conversationId: chat.id,
        input: {
          parentId: null,
          parts: [{ text: "hello", type: "text" }],
          type: "message",
        },
      },
      method: "POST",
    });
    expect(untargeted.status).toBe(404);
  });
});

describe("approvals access", () => {
  it("only lets someone who may use the run's agent decide its tool calls", async () => {
    const carol = await someone();
    const bob = await someone();
    const agent = await privateAgent(carol);
    const agentRef = { resourceId: agent.id, resourceType: "agent" as const };
    const useGrant = await share(carol, agentRef, h.ownerId, "use");
    const chat = await newConversation();
    await share(
      h.ownerId,
      { resourceId: chat.id, resourceType: "conversation" },
      bob,
      "editor"
    );

    const tools = {
      write_file: tool({
        execute: ({ path }: { path: string }) => `wrote ${path}`,
        inputSchema: z.object({ path: z.string() }),
      }),
    };
    const toolApproval = { write_file: "user-approval" } as const;
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: toolCallStream("write_file", { path: "a.txt" }),
      }),
      toolApproval,
      tools,
    });
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Done.") }),
      toolApproval,
      tools,
    });
    const created = (await (
      await send(chat.id, { id: agent.id, type: "agent" })
    ).json()) as CreateRunOutput;
    await h.services.executor.idle();

    const decide = (as?: UserId) =>
      h.request(`/api/runs/${created.runId}/approvals`, {
        as,
        json: {
          decisions: [
            { decision: { decision: "approve" }, toolCallId: "call-1" },
          ],
        },
        method: "POST",
      });

    // Bob edits the chat but can't use Carol's agent.
    expect((await decide(bob)).status).toBe(403);
    // Nor can the owner once Carol stops sharing it.
    await deleteGrant(h.db, useGrant.id);
    expect((await decide()).status).toBe(403);

    await share(carol, agentRef, h.ownerId, "use");
    expect((await decide()).status).toBe(200);
    await h.services.executor.idle();
    const run = await h.request(`/api/runs/${created.runId}`);
    expect(
      ((await run.json()) as { state: { status: string } }).state.status
    ).toBe("succeeded");
  });
});

describe("approvals on a draft run", () => {
  it("take edit on the agent, not just use (033 with 032)", async () => {
    const carol = await someone();
    const bob = await someone();
    // Carol's agent, still a draft.
    const { draft, item: agent } = await createVersionedItem(h.db, "agent", {
      createdBy: carol,
      definition,
      name: "Reviewer",
      owner: { id: carol, type: "user" },
    });
    const agentRef = { resourceId: agent.id, resourceType: "agent" as const };
    await share(carol, agentRef, h.ownerId, "edit");
    await share(carol, agentRef, bob, "use");
    const chat = await newConversation();
    await share(
      h.ownerId,
      { resourceId: chat.id, resourceType: "conversation" },
      bob,
      "editor"
    );

    const tools = {
      write_file: tool({
        execute: ({ path }: { path: string }) => `wrote ${path}`,
        inputSchema: z.object({ path: z.string() }),
      }),
    };
    const toolApproval = { write_file: "user-approval" } as const;
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: toolCallStream("write_file", { path: "a.txt" }),
      }),
      toolApproval,
      tools,
    });
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Done.") }),
      toolApproval,
      tools,
    });
    const created = (await (
      await send(chat.id, { id: agent.id, type: "agent", versionId: draft.id })
    ).json()) as CreateRunOutput;
    await h.services.executor.idle();
    expect(
      expectOk(await getRun(h.db, created.runId as RunId)).agentDraft
    ).toBe(true);

    const decide = (as?: UserId) =>
      h.request(`/api/runs/${created.runId}/approvals`, {
        as,
        json: {
          decisions: [
            { decision: { decision: "approve" }, toolCallId: "call-1" },
          ],
        },
        method: "POST",
      });

    // Bob edits the chat and may use the agent, but not edit it.
    expect((await decide(bob)).status).toBe(403);
    // Nor may the owner once they're down to `use`.
    await share(carol, agentRef, h.ownerId, "use");
    expect((await decide()).status).toBe(403);

    await share(carol, agentRef, h.ownerId, "edit");
    expect((await decide()).status).toBe(200);
    await h.services.executor.idle();
    const run = await h.request(`/api/runs/${created.runId}`);
    expect(
      ((await run.json()) as { state: { status: string } }).state.status
    ).toBe("succeeded");
  });
});

describe("createTurnResolver", () => {
  it("won't answer with an agent its run's creator can no longer use", async () => {
    const carol = await someone();
    const agent = await privateAgent(carol);
    const resolve = createTurnResolver({
      config: testConfig(),
      db: h.db,
      keyStore: createMemoryKeyStore([]),
      registry: createMemoryProviderRegistry({
        keyless: ["test"],
        languageModels: {
          "test:model": new MockLanguageModelV4({
            doStream: textStream("Hi"),
          }),
        },
      }),
    });
    const run = {
      context: { type: "personal" as const },
      conversationId: newId("conversation"),
      createdBy: h.ownerId,
      options: { sandbox: "auto" as const, webSearch: "auto" as const },
      runId: newId("run"),
      target: { id: agent.id, type: "agent" as const },
      userMessageId: newId("message"),
    };
    const state = { facts: {}, history: [], input: "" };

    const refused = await resolve(run as never, { state });
    expect(refused.ok).toBe(false);

    await share(
      carol,
      { resourceId: agent.id, resourceType: "agent" },
      h.ownerId,
      "use"
    );
    const answered = await resolve(run as never, { state });
    expect(answered.ok && answered.value.agent).toEqual({
      id: agent.id,
      versionId: agent.versionId,
    });
  });
});

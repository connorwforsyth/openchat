import { CHIPS_DATA, type PlacedChip } from "@workspace/ai/messages/chips";
import { textStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  CreateRunOutput,
  PickedSkill,
  Run,
} from "@workspace/contract/schemas/runs";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { expectOk, seedOrg, seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../testing/harness";

// What the composer's chips do once a message is sent, through real turns:
// an `@agent` chip makes that agent answer (its owner's draft too), a skill
// chip's pick may be the owner's draft, and an artifact chip tells the turn
// which type to make.

const MODEL = "test:chat";
const AGENT_MARKER = "MARKER-AGENT-CHIP";
const SKILL_MARKER = "MARKER-SKILL-DRAFT";

let h: Harness | undefined;
afterEach(() => h?.close());

const model = () =>
  new MockLanguageModelV4({
    doStream: () => Promise.resolve(textStream("Done.")),
  });

const systemOf = (each: MockLanguageModelV4, call = 0): string =>
  (each.doStreamCalls[call]?.prompt ?? [])
    .flatMap((message) =>
      message.role === "system" ? [message.content as string] : []
    )
    .join("\n");

const makeAgent = async (
  harness: Harness,
  { publish }: { readonly publish: boolean }
): Promise<{ id: LibraryItemId; draftId: LibraryVersionId }> => {
  const { db, ownerId } = harness;
  const { draft, item } = await createVersionedItem(db, "agent", {
    createdBy: ownerId,
    definition: {
      approvals: { default: "ask", tools: {} },
      conversationStarters: [],
      instructions: `You are a researcher. ${AGENT_MARKER}`,
      kind: "agent",
      knowledgeFileIds: [],
      mcpServers: [],
      model: MODEL,
      parameters: {},
      sandboxProvider: null,
      skills: [],
      tools: [],
    },
    name: "Researcher",
    owner: { id: ownerId, type: "user" },
  });
  const id = item.id as LibraryItemId;
  if (publish) {
    expectOk(await publishDraft(db, "agent", id, { publishedBy: ownerId }));
  }
  return { draftId: draft.id as LibraryVersionId, id };
};

const draftSkill = async (
  harness: Harness
): Promise<{ id: LibraryItemId; draftId: LibraryVersionId }> => {
  const { draft, item } = await createVersionedItem(harness.db, "skill", {
    createdBy: harness.ownerId,
    definition: {
      kind: "skill",
      skillMd: `---\nname: terse\ndescription: Short answers.\n---\n\nBe terse. ${SKILL_MARKER}\n`,
    },
    name: "Terse",
    owner: { id: harness.ownerId, type: "user" },
  });
  return {
    draftId: draft.id as LibraryVersionId,
    id: item.id as LibraryItemId,
  };
};

const someone = async (harness: Harness): Promise<UserId> => {
  const row = await seedUser(harness.db);
  await seedOrg(harness.db, row.id, { isPersonal: true });
  return row.id as UserId;
};

const newChat = async (harness: Harness, as?: UserId) => {
  const response = await harness.request("/api/conversations", {
    as,
    json: {},
    method: "POST",
  });
  return ((await response.json()) as Conversation).id;
};

const chipsPart = (
  text: string,
  chips: readonly PlacedChip[]
): MessagePart[] => [
  { text, type: "text" },
  // Branded ids are strings on the wire.
  { data: { chips: chips as never }, name: CHIPS_DATA, type: "data" },
];

const send = async (
  harness: Harness,
  {
    as,
    conversationId,
    parts,
    skills,
  }: {
    readonly as?: UserId;
    readonly conversationId?: ConversationId;
    readonly parts: readonly MessagePart[];
    readonly skills?: readonly PickedSkill[];
  }
) => {
  const chat = conversationId ?? (await newChat(harness, as));
  const response = await harness.request("/api/runs", {
    as,
    json: {
      conversationId: chat,
      input: {
        parentId: null,
        parts,
        ...(skills ? { skills } : {}),
        type: "message",
      },
      // The composer's own pick, which an agent chip overrides.
      target: { model: MODEL, type: "model" },
    },
    method: "POST",
  });
  if (response.status !== 202) {
    return { status: response.status };
  }
  const created = (await response.json()) as CreateRunOutput;
  await harness.services.executor.idle();
  const run = (await (
    await harness.request(`/api/runs/${created.runId}`, { as })
  ).json()) as Run;
  return { conversationId: chat, created, run, status: 202 };
};

const agentChip = (
  id: LibraryItemId,
  versionId?: LibraryVersionId
): PlacedChip => ({
  end: 11,
  id,
  kind: "agent",
  label: "Researcher",
  start: 0,
  ...(versionId ? { versionId } : {}),
});

describe("an @agent chip", () => {
  it("makes that agent answer, over the composer's target, and again on regenerate", async () => {
    const chat = model();
    h = await createHarness({ models: { [MODEL]: chat }, realTurns: true });
    const agent = await makeAgent(h, { publish: true });
    const sent = await send(h, {
      parts: chipsPart("@Researcher what's new?", [agentChip(agent.id)]),
    });
    expect(sent.status).toBe(202);
    expect(sent.run?.target).toEqual({ id: agent.id, type: "agent" });
    expect(systemOf(chat)).toContain(AGENT_MARKER);

    const again = await h.request("/api/runs", {
      json: {
        conversationId: sent.conversationId,
        input: {
          type: "regenerate",
          userMessageId: sent.created?.userMessageId,
        },
        target: { model: MODEL, type: "model" },
      },
      method: "POST",
    });
    expect(again.status).toBe(202);
    await h.services.executor.idle();
    expect(systemOf(chat, 1)).toContain(AGENT_MARKER);
  });

  it("answers with its owner's draft, which no one else can run", async () => {
    const chat = model();
    h = await createHarness({ models: { [MODEL]: chat }, realTurns: true });
    const agent = await makeAgent(h, { publish: false });
    const chip = agentChip(agent.id, agent.draftId);

    const mine = await send(h, {
      parts: chipsPart("@Researcher hi", [chip]),
    });
    expect(mine.status).toBe(202);
    expect(mine.run?.target).toEqual({
      id: agent.id,
      type: "agent",
      versionId: agent.draftId,
    });
    expect(systemOf(chat)).toContain(AGENT_MARKER);

    const theirs = await send(h, {
      as: await someone(h),
      parts: chipsPart("@Researcher hi", [chip]),
    });
    expect(theirs.status).toBe(404);
    expect(chat.doStreamCalls).toHaveLength(1);
  });
});

describe("a skill chip", () => {
  it("loads its owner's draft for the turn, and only for its owner", async () => {
    const chat = model();
    h = await createHarness({ models: { [MODEL]: chat }, realTurns: true });
    const skill = await draftSkill(h);
    const pick = { id: skill.id, versionId: skill.draftId };

    const mine = await send(h, {
      parts: [{ text: "Hello", type: "text" }],
      skills: [pick],
    });
    expect(mine.status).toBe(202);
    expect(systemOf(chat)).toContain(SKILL_MARKER);

    const theirs = await send(h, {
      as: await someone(h),
      parts: [{ text: "Hello", type: "text" }],
      skills: [pick],
    });
    expect(theirs.status).toBe(422);
    expect(chat.doStreamCalls).toHaveLength(1);
  });
});

describe("an artifact chip", () => {
  it("tells the turn which type to make", async () => {
    const chat = model();
    h = await createHarness({ models: { [MODEL]: chat }, realTurns: true });
    const sent = await send(h, {
      parts: chipsPart("@Slides about otters", [
        {
          artifact: "presentation",
          end: 7,
          kind: "artifact",
          label: "Slides",
          start: 0,
        },
      ]),
    });
    expect(sent.status).toBe(202);
    expect(systemOf(chat)).toContain(
      'The user picked "Slides" in this message: they want a `presentation` artifact.'
    );
  });

  it("adds nothing to a message without one", async () => {
    const chat = model();
    h = await createHarness({ models: { [MODEL]: chat }, realTurns: true });
    await send(h, { parts: [{ text: "Hello", type: "text" }] });
    expect(systemOf(chat)).not.toContain("The user picked");
  });
});

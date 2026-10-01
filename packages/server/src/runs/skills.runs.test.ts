import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import { SKILLS_DATA } from "@workspace/ai/messages/skills";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  FileId,
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  CreateRunOutput,
  PickedSkill,
  Run,
  RunOptions,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import { createFile } from "@workspace/db/queries/files";
import { upsertGrant } from "@workspace/db/queries/grants";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { replaceSkillFiles } from "@workspace/db/queries/library-items";
import { getMessage } from "@workspace/db/queries/messages";
import { expectOk, seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../testing/harness";

// Skills in chats through real turns (127): a skill picked for a message is
// checked with the library's usable rule, kept with the message, and its
// instructions reach the model as their own section; an agent's attached
// skills are listed by name and loaded with `load_skill`, which reads only
// the skills the turn was given and their files by path, without asking.

const MODEL = "test:chat";
const MARKER = "MARKER-SKILL-127";

let h: Harness | undefined;
afterEach(() => h?.close());

/** A model that plays `steps` in order, one per call, then says "Done.". */
const scripted = (steps: readonly (() => LanguageModelV4StreamResult)[]) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const step = steps[calls];
      calls += 1;
      return Promise.resolve(step ? step() : textStream("Done."));
    },
  });
};

const systemOf = (model: MockLanguageModelV4, call = 0): string =>
  (model.doStreamCalls[call]?.prompt ?? [])
    .flatMap((message) =>
      message.role === "system" ? [message.content as string] : []
    )
    .join("\n");

const offered = (model: MockLanguageModelV4, call = 0): string[] =>
  (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name).sort();

/** What the model was sent as a tool's result on call `call`. */
const toolResultsOf = (model: MockLanguageModelV4, call: number): string =>
  JSON.stringify(
    (model.doStreamCalls[call]?.prompt ?? []).filter(
      (message) => message.role === "tool"
    )
  );

const harnessWith = async (
  model: MockLanguageModelV4,
  files: Readonly<Record<string, string>> = {}
) => {
  h = await createHarness({
    models: { [MODEL]: model },
    realTurns: true,
    skillFiles: (fileId) =>
      Promise.resolve(
        files[fileId] === undefined
          ? null
          : new TextEncoder().encode(files[fileId])
      ),
  });
  return h;
};

const publishSkill = async (
  harness: Harness,
  {
    body = `Answer in haiku. ${MARKER}`,
    files = [],
    name = "Haiku",
    owner = harness.ownerId,
    publish = true,
  }: {
    readonly body?: string;
    readonly files?: readonly { readonly fileId: FileId; path: string }[];
    readonly name?: string;
    readonly owner?: UserId;
    readonly publish?: boolean;
  } = {}
): Promise<{ id: LibraryItemId; versionId: LibraryVersionId | null }> => {
  const { db } = harness;
  const { item } = await createVersionedItem(db, "skill", {
    createdBy: owner,
    definition: {
      kind: "skill",
      skillMd: `---\nname: ${name.toLowerCase()}\ndescription: Writes ${name.toLowerCase()} replies.\n---\n\n${body}\n`,
    },
    description: "From the library item.",
    name,
    owner: { id: owner, type: "user" },
  });
  const id = item.id as LibraryItemId;
  if (!publish) {
    return { id, versionId: null };
  }
  const published = expectOk(
    await publishDraft(db, "skill", id, { publishedBy: owner })
  );
  await replaceSkillFiles(db, published.version.id, files);
  return { id, versionId: published.version.id };
};

const upload = async (harness: Harness, name: string): Promise<FileId> =>
  (
    await createFile(harness.db, {
      mediaType: "text/markdown",
      name,
      ownerId: harness.ownerId,
      purpose: "skill",
      size: 10,
      storageDriver: "local",
      storageKey: `skills/${name}-${crypto.randomUUID()}`,
    })
  ).id as FileId;

const publishAgent = async (
  harness: Harness,
  skills: AgentDefinition["skills"]
): Promise<RunTarget> => {
  const { db, ownerId } = harness;
  const { item } = await createVersionedItem(db, "agent", {
    createdBy: ownerId,
    definition: {
      // The agent asks before every tool; `load_skill` still doesn't.
      approvals: { default: "ask", tools: {} },
      conversationStarters: [],
      instructions: "You are a poet.",
      kind: "agent",
      knowledgeFileIds: [],
      mcpServers: [],
      model: MODEL,
      parameters: {},
      sandboxProvider: null,
      skills,
      tools: [],
    },
    name: "Poet",
    owner: { id: ownerId, type: "user" },
  });
  const id = item.id as LibraryItemId;
  expectOk(await publishDraft(db, "agent", id, { publishedBy: ownerId }));
  return { id, type: "agent" };
};

const newChat = async (harness: Harness): Promise<ConversationId> => {
  const response = await harness.request("/api/conversations", {
    json: {},
    method: "POST",
  });
  return ((await response.json()) as Conversation).id;
};

const text = (value: string): MessagePart => ({ text: value, type: "text" });

/** Sends a message; the response, and once it's taken, the run when it stops. */
const send = async (
  harness: Harness,
  {
    options,
    parts = [text("Write about spring.")],
    skills,
    target = { model: MODEL, type: "model" },
  }: {
    readonly options?: Partial<RunOptions>;
    readonly parts?: readonly MessagePart[];
    readonly skills?: readonly PickedSkill[];
    readonly target?: RunTarget;
  } = {}
) => {
  const conversationId = await newChat(harness);
  const response = await harness.request("/api/runs", {
    json: {
      conversationId,
      input: {
        parentId: null,
        parts,
        ...(skills ? { skills } : {}),
        type: "message",
      },
      ...(options ? { options } : {}),
      target,
    },
    method: "POST",
  });
  if (response.status !== 202) {
    return { body: await response.text(), status: response.status };
  }
  const created = (await response.json()) as CreateRunOutput;
  await harness.services.executor.idle();
  const run = (await (
    await harness.request(`/api/runs/${created.runId}`)
  ).json()) as Run;
  return { conversationId, created, run, status: 202 };
};

describe("a skill picked for a message", () => {
  it("puts its instructions in the turn, and is kept with the message", async () => {
    const model = scripted([]);
    const harness = await harnessWith(model);
    const skill = await publishSkill(harness);
    const sent = await send(harness, {
      parts: [
        text("Write about spring."),
        // A client can't write the record itself.
        {
          data: { skills: [{ id: skill.id, name: "Forged" }] },
          name: SKILLS_DATA,
          type: "data",
        },
      ],
      skills: [{ id: skill.id }],
    });
    expect(sent.status).toBe(202);
    const system = systemOf(model);
    expect(system).toContain('The user picked the skill "Haiku"');
    expect(system).toContain(MARKER);
    // The frontmatter is the library's business, not the model's.
    expect(system).not.toContain("name: haiku");

    const stored = expectOk(
      await getMessage(harness.db, sent.created?.userMessageId as never)
    );
    expect(stored.parts).toEqual([
      text("Write about spring."),
      {
        data: {
          skills: [{ id: skill.id, name: "Haiku", versionId: skill.versionId }],
        },
        name: SKILLS_DATA,
        type: "data",
      },
    ]);
  });

  it("is used again when the answer is regenerated", async () => {
    const model = scripted([]);
    const harness = await harnessWith(model);
    const skill = await publishSkill(harness);
    const sent = await send(harness, { skills: [{ id: skill.id }] });
    const again = await harness.request("/api/runs", {
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
    await harness.services.executor.idle();
    expect(systemOf(model, 1)).toContain(MARKER);
  });

  it("is refused unless the sender may use a published version of it", async () => {
    const model = scripted([]);
    const harness = await harnessWith(model);
    const stranger = await seedUser(harness.db);
    const theirs = await publishSkill(harness, { owner: stranger.id });
    const draft = await publishSkill(harness, { publish: false });

    for (const id of [theirs.id, draft.id]) {
      // biome-ignore lint/performance/noAwaitInLoops: two refusals, one at a time.
      const refused = await send(harness, { skills: [{ id }] });
      expect(refused.status).toBe(422);
      expect(refused.body).toContain("No such skill, or you can't use it.");
    }
    expect(model.doStreamCalls).toHaveLength(0);

    // Shared for use, it's usable (the library's own rule).
    await upsertGrant(harness.db, {
      grantedBy: stranger.id,
      permission: "use",
      principal: { id: harness.ownerId, type: "user" },
      resource: { resourceId: theirs.id, resourceType: "skill" },
    });
    expect((await send(harness, { skills: [{ id: theirs.id }] })).status).toBe(
      202
    );
    expect(systemOf(model)).toContain(MARKER);
  });

  it("brings load_skill for the files it bundles, which reads them by path", async () => {
    const model = scripted([
      () =>
        toolCallStream(
          "load_skill",
          { path: "templates/form.md", skill: "Haiku" },
          "s1"
        ),
    ]);
    const harnessFiles: Record<string, string> = {};
    const harness = await harnessWith(model, harnessFiles);
    const fileId = await upload(harness, "form.md");
    harnessFiles[fileId] = "five, seven, five";
    const skill = await publishSkill(harness, {
      files: [{ fileId, path: "templates/form.md" }],
    });
    const sent = await send(harness, { skills: [{ id: skill.id }] });
    expect(sent.run?.state.status).toBe("succeeded");
    expect(offered(model)).toContain("load_skill");
    expect(systemOf(model)).toContain("- templates/form.md");
    expect(toolResultsOf(model, 1)).toContain("five, seven, five");
  });

  it("keeps its instructions and load_skill in plan mode, which writes nothing", async () => {
    const model = scripted([]);
    const harness = await harnessWith(model);
    const skill = await publishSkill(harness);
    await send(harness, {
      options: { mode: "plan" },
      skills: [{ id: skill.id }],
    });
    expect(systemOf(model)).toContain(MARKER);
    expect(systemOf(model)).toContain("This turn is for planning only.");
    expect(offered(model)).toContain("load_skill");
    expect(offered(model)).not.toContain("create_artifact");
  });
});

describe("an agent's own skills", () => {
  it("are listed by name and description, and loaded with load_skill without asking", async () => {
    const model = scripted([
      () => toolCallStream("load_skill", { skill: "haiku" }, "s1"),
      () => toolCallStream("load_skill", { skill: "Limerick" }, "s2"),
    ]);
    const harness = await harnessWith(model);
    const skill = await publishSkill(harness);
    // Another of the owner's skills, not attached to the agent.
    await publishSkill(harness, { body: "Limericks.", name: "Limerick" });
    const target = await publishAgent(harness, [{ id: skill.id }]);

    const sent = await send(harness, { target });
    expect(sent.run?.state.status).toBe("succeeded");
    const system = systemOf(model);
    expect(system).toContain("You are a poet.");
    expect(system).toContain("- Haiku: Writes haiku replies.");
    expect(system).not.toContain(MARKER);
    expect(offered(model)).toContain("load_skill");

    expect(toolResultsOf(model, 1)).toContain(MARKER);
    // Only what the turn was given: an unattached skill isn't found.
    expect(toolResultsOf(model, 2)).toContain("No such skill here.");
    expect(toolResultsOf(model, 2)).not.toContain("Limericks.");
  });

  it("come with picks for the message, which go in whole", async () => {
    const model = scripted([]);
    const harness = await harnessWith(model);
    const attached = await publishSkill(harness);
    const picked = await publishSkill(harness, {
      body: "Rhyme it. MARKER-PICKED",
      name: "Rhyme",
    });
    const target = await publishAgent(harness, [{ id: attached.id }]);
    await send(harness, { skills: [{ id: picked.id }], target });
    const system = systemOf(model);
    expect(system).toContain("MARKER-PICKED");
    expect(system).toContain("- Haiku: Writes haiku replies.");
    expect(system.indexOf("You are a poet.")).toBeLessThan(
      system.indexOf("MARKER-PICKED")
    );
  });

  it("without any, the turn has no load_skill", async () => {
    const model = scripted([]);
    const harness = await harnessWith(model);
    await send(harness, { target: await publishAgent(harness, []) });
    expect(offered(model)).not.toContain("load_skill");
    expect(systemOf(model)).not.toContain("load_skill");
  });
});

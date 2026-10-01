import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  LibraryItemId,
  MessageId,
  RunId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type {
  CreateRunOutput,
  RunOptions,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { listLibraryItems } from "@workspace/db/queries/library-items";
import { getMessage } from "@workspace/db/queries/messages";
import { getRun } from "@workspace/db/queries/runs";
import { expectOk } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../testing/harness";

// The skill-authoring tools in real turns (128): a plain chat is offered
// them, each call waits for the person, and an approved call writes to the
// person's library; a planning run never sees them (they write); an agent
// that lists them can make creating automatic, but publishing still asks.

const MODEL = "test:chat";
const SKILL_TOOLS = ["create_skill", "publish_skill", "update_skill"];

let h: Harness | undefined;
afterEach(() => h?.close());

/** A model that plays `steps` in order, one per call, then says "Done.". */
const scripted = (
  steps: readonly (() =>
    | LanguageModelV4StreamResult
    | Promise<LanguageModelV4StreamResult>)[]
) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[calls];
      calls += 1;
      return step ? await step() : textStream("Done.");
    },
  });
};

const offered = (model: MockLanguageModelV4, call = 0): string[] =>
  (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name).sort();

const newChat = async (harness: Harness): Promise<ConversationId> => {
  const response = await harness.request("/api/conversations", {
    json: {},
    method: "POST",
  });
  return ((await response.json()) as Conversation).id;
};

const send = async (
  harness: Harness,
  {
    options,
    target = { model: MODEL, type: "model" },
  }: {
    readonly options?: Partial<RunOptions>;
    readonly target?: RunTarget;
  } = {}
): Promise<RunId> => {
  const response = await harness.request("/api/runs", {
    json: {
      conversationId: await newChat(harness),
      input: {
        parentId: null,
        parts: [{ text: "Make me a release notes skill.", type: "text" }],
        type: "message",
      },
      ...(options ? { options } : {}),
      target,
    },
    method: "POST",
  });
  if (response.status !== 202) {
    throw new Error(`expected 202, got ${response.status}`);
  }
  const created = (await response.json()) as CreateRunOutput;
  await harness.services.executor.idle();
  return created.runId as RunId;
};

const runOf = async (harness: Harness, runId: RunId) =>
  expectOk(await getRun(harness.db, runId));

const approveAll = async (harness: Harness, runId: RunId) => {
  const run = await runOf(harness, runId);
  if (run.status !== "awaiting_approval") {
    throw new Error(`the run is ${run.status}, not waiting on anyone`);
  }
  expectOk(
    await harness.services.executor.submitApprovals(
      runId,
      (run.approvals ?? []).map(({ toolCallId }) => ({
        decision: { decision: "approve" as const },
        toolCallId,
      })),
      harness.ownerId
    )
  );
  await harness.services.executor.idle();
};

const skillsOf = async (harness: Harness) =>
  await listLibraryItems(harness.db, {
    kind: "skill",
    limit: 50,
    owners: [{ id: harness.ownerId, type: "user" }],
  });

const create = {
  description: "Writes release notes.",
  instructions: "Group changes by area.",
  name: "Release notes",
};

describe("the skill tools in a plain chat", () => {
  it("are offered, ask first, and once approved save a draft the model reads back", async () => {
    const model = scripted([
      () => toolCallStream("create_skill", create, "c1"),
    ]);
    h = await createHarness({ models: { [MODEL]: model }, realTurns: true });
    expect(offered(model)).toEqual([]);
    const runId = await send(h);
    expect(offered(model)).toEqual(expect.arrayContaining(SKILL_TOOLS));

    const waiting = await runOf(h, runId);
    expect(waiting.approvals?.map((each) => each.toolName)).toEqual([
      "create_skill",
    ]);
    expect(await skillsOf(h)).toEqual([]);

    await approveAll(h, runId);
    const done = await runOf(h, runId);
    expect(done.status).toBe("succeeded");
    const [skill] = await skillsOf(h);
    expect(skill?.row).toMatchObject({
      latestVersionId: null,
      name: create.name,
    });

    // The model read the outcome as text, with the id it needs next.
    const read = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
    expect(read).toContain(`skillId: ${skill?.row.id}`);
    expect(read).toContain("it's a draft");
    const answer = expectOk(
      await getMessage(h.db, done.assistantMessageId as MessageId)
    );
    const result = answer.parts.find((part) => part.type === "tool-result");
    expect(result).toMatchObject({
      output: {
        status: "success",
        value: {
          skill: { name: create.name, state: "draft", version: 1 },
          status: "saved",
        },
      },
      toolName: "create_skill",
    });
  });

  it("are withheld from a planning run, and a call to one changes nothing (106)", async () => {
    const model = scripted([
      () => toolCallStream("create_skill", create, "c1"),
      () =>
        toolCallStream(
          "publish_skill",
          { skillId: crypto.randomUUID(), skillName: "x" },
          "p1"
        ),
    ]);
    h = await createHarness({ models: { [MODEL]: model }, realTurns: true });
    const runId = await send(h, { options: { mode: "plan" } });
    for (const call of model.doStreamCalls.keys()) {
      for (const name of SKILL_TOOLS) {
        expect(offered(model, call)).not.toContain(name);
      }
    }
    const run = await runOf(h, runId);
    expect(run.status).toBe("succeeded");
    // The call came back as a tool error the model read (131). A planning
    // turn that keeps no tools at all gets the SDK's own wording, so only
    // the tool's name is checked here.
    const read = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(read).toContain('"error-text"');
    expect(read).toContain("create_skill");
    expect(await skillsOf(h)).toEqual([]);
  });
});

describe("the skill tools under an agent", () => {
  const agent = async (
    harness: Harness,
    approvals: AgentDefinition["approvals"]
  ): Promise<RunTarget> => {
    const { item } = await createVersionedItem(harness.db, "agent", {
      createdBy: harness.ownerId,
      definition: {
        approvals,
        conversationStarters: [],
        instructions: "You write skills.",
        kind: "agent",
        knowledgeFileIds: [],
        mcpServers: [],
        model: MODEL,
        parameters: {},
        sandboxProvider: null,
        skills: [],
        tools: ["create_skill", "publish_skill"],
      },
      name: "Skill writer",
      owner: { id: harness.ownerId, type: "user" },
    });
    expectOk(
      await publishDraft(harness.db, "agent", item.id, {
        publishedBy: harness.ownerId,
      })
    );
    return { id: item.id as LibraryItemId, type: "agent" };
  };

  it("are offered only by name; `auto` can skip asking to create, never to publish", async () => {
    const model = scripted([
      () => toolCallStream("create_skill", create, "c1"),
      // The model publishes the skill the first step made.
      async () => {
        const [skill] = h ? await skillsOf(h) : [];
        return toolCallStream(
          "publish_skill",
          { skillId: skill?.row.id ?? "", skillName: create.name },
          "p1"
        );
      },
    ]);
    h = await createHarness({ models: { [MODEL]: model }, realTurns: true });
    const target = await agent(h, {
      default: "auto",
      tools: { create_skill: "auto", publish_skill: "auto" },
    });
    const runId = await send(h, { target });
    expect(offered(model)).toEqual(
      expect.arrayContaining(["create_skill", "publish_skill"])
    );
    expect(offered(model)).not.toContain("update_skill");

    // Created without asking; the publish waits.
    const waiting = await runOf(h, runId);
    expect(waiting.status).toBe("awaiting_approval");
    expect(waiting.approvals?.map((each) => each.toolName)).toEqual([
      "publish_skill",
    ]);
    const [skill] = await skillsOf(h);
    expect(skill?.row.latestVersionId).toBeNull();

    await approveAll(h, runId);
    expect((await runOf(h, runId)).status).toBe("succeeded");
    const [after] = await skillsOf(h);
    expect(after?.row.latestVersionId).not.toBeNull();
  });
});

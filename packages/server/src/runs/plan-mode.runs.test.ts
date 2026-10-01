import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  CreateRunOutput,
  Run,
  RunOptions,
} from "@workspace/contract/schemas/runs";
import {
  listArtifacts,
  listArtifactVersions,
} from "@workspace/db/queries/artifacts";
import { getMessage } from "@workspace/db/queries/messages";
import { type Tool, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createHarness, type Harness } from "../testing/harness";
import { PLAN_REFUSED } from "./plan-mode";

// Plan mode through real runs (106): the server withholds every writing
// tool from a planning run and refuses a call to one, holds bash to
// read-only commands, saves the plan as an artifact, and a later run
// carries the approved version without approving anything else for it.

const MODEL = "test:chat";

let h: Harness | undefined;
afterEach(() => h?.close());

const PLAN = [
  "# Add a dark theme",
  "",
  "## Goal",
  "The app follows the system theme.",
  "",
  "## Steps",
  "1. Add the tokens.",
  "",
  "## Files to touch",
  "- globals.css",
  "",
  "## Risks",
  "Contrast.",
  "",
  "## Open questions",
  "None",
].join("\n");

/** A model that plays `steps` in order, one per call, then writes the plan. */
const scripted = (
  steps: readonly (() => LanguageModelV4StreamResult)[],
  last = PLAN
) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const step = steps[calls];
      calls += 1;
      return Promise.resolve(step ? step() : textStream(last));
    },
  });
};

/** The tools a model call was offered, by name. */
const offered = (model: MockLanguageModelV4, call = 0): string[] =>
  (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name).sort();

/** The system prompt a model call got. */
const systemOf = (model: MockLanguageModelV4, call = 0): string =>
  (model.doStreamCalls[call]?.prompt ?? [])
    .flatMap((message) =>
      message.role === "system" ? [message.content as string] : []
    )
    .join("\n");

const json = async <T>(response: Response, status = 200): Promise<T> => {
  if (response.status !== status) {
    throw new Error(
      `expected ${status}, got ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

const newChat = async (harness: Harness): Promise<ConversationId> =>
  (
    await json<Conversation>(
      await harness.request("/api/conversations", { json: {}, method: "POST" }),
      201
    )
  ).id;

/** Sends a message and waits for its run to stop. */
const send = async (
  harness: Harness,
  conversationId: ConversationId,
  parts: readonly MessagePart[],
  {
    options,
    parentId = null,
    target = true,
  }: {
    readonly options?: Partial<RunOptions>;
    readonly parentId?: MessageId | null;
    readonly target?: boolean;
  } = {}
) => {
  const created = await json<CreateRunOutput>(
    await harness.request("/api/runs", {
      json: {
        conversationId,
        input: { parentId, parts, type: "message" },
        ...(options ? { options } : {}),
        ...(target ? { target: { model: MODEL, type: "model" } } : {}),
      },
      method: "POST",
    }),
    202
  );
  await harness.services.executor.idle();
  const run = await json<Run>(
    await harness.request(`/api/runs/${created.runId}`)
  );
  return { created, run };
};

const text = (value: string): MessagePart => ({ text: value, type: "text" });

/** A tool that records what it was asked to do. */
const spyTool = () => {
  const execute = vi.fn(async (input: unknown) => ({ input, status: "ran" }));
  return {
    execute,
    tool: tool({
      description: "test",
      execute,
      inputSchema: z.looseObject({}),
    }) as Tool,
  };
};

describe("a planning run's tools", () => {
  /**
   * Scripts a planning run whose resolver (wrongly) offers writing tools,
   * to show the executor still holds it to reading.
   */
  const offering = (harness: Harness, model: MockLanguageModelV4) => {
    const spies = {
      bash: spyTool(),
      create_artifact: spyTool(),
      edit: spyTool(),
      read: spyTool(),
      update_memory: spyTool(),
      write: spyTool(),
    };
    harness.nextTurn({
      model,
      toolApproval: {
        bash: "not-applicable",
        create_artifact: "user-approval",
        edit: "user-approval",
        read: "not-applicable",
        update_memory: "not-applicable",
        write: "not-applicable",
      },
      tools: Object.fromEntries(
        Object.entries(spies).map(([name, spy]) => [name, spy.tool])
      ),
    });
    return spies;
  };

  it("are only the reading ones, and bash runs only read-only commands", async () => {
    h = await createHarness();
    const model = scripted([
      () => toolCallStream("bash", { command: "ls; rm -rf /" }, "b1"),
      () => toolCallStream("bash", { command: "cat $(echo a)" }, "b2"),
      () => toolCallStream("bash", { command: "ls | sh" }, "b3"),
      () => toolCallStream("bash", { command: "ls > out.txt" }, "b4"),
      () => toolCallStream("bash", { command: "ls && touch x" }, "b5"),
      () => toolCallStream("bash", { command: "rm -rf /" }, "b6"),
      () => toolCallStream("bash", { command: "ls -la src" }, "b7"),
      () => toolCallStream("read", { path: "README.md" }, "r1"),
    ]);
    const spies = offering(h, model);
    const chat = await newChat(h);
    const { run } = await send(h, chat, [text("Plan a dark theme")], {
      options: { mode: "plan" },
    });

    expect(run.state.status).toBe("succeeded");
    expect(run.options?.mode).toBe("plan");
    // The model never saw a writing tool, on any step.
    expect(model.doStreamCalls).toHaveLength(9);
    for (let call = 0; call < model.doStreamCalls.length; call += 1) {
      expect(offered(model, call)).toEqual(["bash", "read"]);
    }
    // Bash ran only the read-only command, once, as checked.
    expect(spies.bash.execute).toHaveBeenCalledOnce();
    expect(spies.bash.execute.mock.calls[0]?.[0]).toEqual({
      command: "ls -la src",
    });
    expect(spies.read.execute).toHaveBeenCalledOnce();

    // Each refusal is a tool error the model read and the answer keeps.
    const answer = await getMessage(h.db, run.assistantMessageId as MessageId);
    const results = new Map(
      (answer.ok ? answer.value.parts : []).flatMap((part) =>
        part.type === "tool-result" ? [[part.toolCallId, part.output]] : []
      )
    );
    for (const id of ["b1", "b2", "b3", "b4", "b5", "b6"]) {
      const output = results.get(id);
      expect(output?.status === "success" && output.value).toMatchObject({
        message: expect.stringContaining(PLAN_REFUSED),
        status: "error",
      });
    }
  });

  it.each(["write", "edit", "update_memory", "create_artifact"])(
    "refuse a direct call to %s: nothing runs and no plan is saved",
    async (name) => {
      h = await createHarness();
      const model = scripted([
        () => toolCallStream(name, { content: "x", path: "a.txt" }, "w1"),
      ]);
      const spies = offering(h, model);
      const chat = await newChat(h);
      const { run } = await send(h, chat, [text("Plan a dark theme")], {
        options: { mode: "plan" },
      });
      expect(offered(model)).toEqual(["bash", "read"]);
      for (const spy of Object.values(spies)) {
        expect(spy.execute).not.toHaveBeenCalled();
      }
      // A call to no tool ends the run, as it does for any unknown name.
      expect(run.state.status).toBe("failed");
      expect(await listArtifacts(h.db, chat)).toEqual([]);
    }
  );

  it("saves the plan as a markdown artifact and points the answer at it", async () => {
    h = await createHarness();
    h.nextTurn({ model: scripted([]) });
    const chat = await newChat(h);
    const { run } = await send(h, chat, [text("Plan a dark theme")], {
      options: { mode: "plan" },
    });
    const [artifact, ...others] = await listArtifacts(h.db, chat);
    expect(others).toEqual([]);
    expect(artifact).toMatchObject({
      kind: "markdown",
      messageId: run.assistantMessageId,
      title: "Plan: Add a dark theme",
    });
    const versions = await listArtifactVersions(h.db, artifact?.id as never);
    expect(versions.map((version) => version.content)).toEqual([PLAN]);
    const answer = await getMessage(h.db, run.assistantMessageId as MessageId);
    expect(answer.ok && answer.value.parts.at(-1)).toEqual({
      data: {
        artifactId: artifact?.id,
        title: "Plan: Add a dark theme",
        versionId: versions[0]?.id,
      },
      name: "plan",
      type: "data",
    });
  });

  it("isn't saved for a normal run", async () => {
    h = await createHarness();
    h.nextTurn({ model: scripted([]) });
    const chat = await newChat(h);
    await send(h, chat, [text("hi")]);
    expect(await listArtifacts(h.db, chat)).toEqual([]);
  });
});

describe("a planning run's turn, resolved for real", () => {
  it("withholds the artifact tools and says it's planning; a normal run is as before", async () => {
    const planner = scripted([]);
    h = await createHarness({ models: { [MODEL]: planner }, realTurns: true });
    const chat = await newChat(h);
    await send(h, chat, [text("Plan it")], { options: { mode: "plan" } });
    expect(offered(planner)).toEqual([]);
    expect(systemOf(planner)).toContain("This turn is for planning only.");
    expect(systemOf(planner)).toContain("## Open questions");

    const builder = scripted([], "ok");
    await h.close();
    h = await createHarness({ models: { [MODEL]: builder }, realTurns: true });
    const other = await newChat(h);
    await send(h, other, [text("Build it")]);
    expect(offered(builder)).toEqual([
      "create_artifact",
      "update_artifact",
      "update_memory",
    ]);
    expect(systemOf(builder)).not.toContain("planning only");
    expect(systemOf(builder)).not.toContain("approved-plan");
  });
});

describe("approving a plan", () => {
  /** A chat with a saved plan; returns its ids. */
  const planned = async (harness: Harness) => {
    const chat = await newChat(harness);
    const { run } = await send(harness, chat, [text("Plan a dark theme")], {
      options: { mode: "plan" },
    });
    const [artifact] = await listArtifacts(harness.db, chat);
    if (!artifact) {
      throw new Error("no plan was saved");
    }
    return {
      artifactId: artifact.id,
      chat,
      parentId: run.assistantMessageId as MessageId,
    };
  };

  it("runs normally with the edited plan, saved first as a new version", async () => {
    const model = scripted([], "ok");
    let calls = 0;
    const planner = scripted([]);
    h = await createHarness({
      models: {
        [MODEL]: new MockLanguageModelV4({
          doStream: (options) => {
            calls += 1;
            return calls === 1
              ? planner.doStream(options)
              : model.doStream(options);
          },
        }),
      },
      realTurns: true,
    });
    const plan = await planned(h);
    const edited = `${PLAN}\n\nAlso: keep the light theme the default.`;
    const { created, run } = await send(
      h,
      plan.chat,
      [
        text("Build the approved plan."),
        {
          data: { artifactId: plan.artifactId, content: edited },
          name: "plan-approval",
          type: "data",
        },
      ],
      { parentId: plan.parentId }
    );

    expect(run.state.status).toBe("succeeded");
    // A normal run: no mode, its tools as usual and still asking.
    expect(run.options?.mode).toBeUndefined();
    expect(offered(model)).toEqual([
      "create_artifact",
      "update_artifact",
      "update_memory",
    ]);
    const versions = await listArtifactVersions(h.db, plan.artifactId);
    expect(versions.map((version) => version.content)).toEqual([PLAN, edited]);
    expect(versions[1]?.messageId).toBe(created.userMessageId);
    // The message keeps which version it approved, not the text.
    const message = await getMessage(h.db, created.userMessageId);
    expect(message.ok && message.value.parts[1]).toEqual({
      data: { artifactId: plan.artifactId, versionId: versions[1]?.id },
      name: "plan-approval",
      type: "data",
    });
    // The model got the approved version.
    const system = systemOf(model);
    expect(system).toContain("The user approved this plan.");
    expect(system).toContain("keep the light theme the default");
    expect(system).not.toContain("planning only");
  });

  it("uses the latest version when nothing was edited", async () => {
    const model = scripted([], "ok");
    let calls = 0;
    const planner = scripted([]);
    h = await createHarness({
      models: {
        [MODEL]: new MockLanguageModelV4({
          doStream: (options) => {
            calls += 1;
            return calls === 1
              ? planner.doStream(options)
              : model.doStream(options);
          },
        }),
      },
      realTurns: true,
    });
    const plan = await planned(h);
    await send(
      h,
      plan.chat,
      [
        text("Build the approved plan."),
        {
          data: { artifactId: plan.artifactId },
          name: "plan-approval",
          type: "data",
        },
      ],
      { parentId: plan.parentId }
    );
    expect(await listArtifactVersions(h.db, plan.artifactId)).toHaveLength(1);
    expect(systemOf(model)).toContain("## Files to touch");
  });

  it("refuses a plan from another chat, or a malformed approval", async () => {
    h = await createHarness();
    h.nextTurn({ model: scripted([]) });
    const plan = await planned(h);
    const elsewhere = await newChat(h);
    const attempt = async (data: unknown) =>
      await h?.request("/api/runs", {
        json: {
          conversationId: elsewhere,
          input: {
            parentId: null,
            parts: [
              text("Build it"),
              { data, name: "plan-approval", type: "data" },
            ],
            type: "message",
          },
          target: { model: MODEL, type: "model" },
        },
        method: "POST",
      });
    expect((await attempt({ artifactId: plan.artifactId }))?.status).toBe(422);
    expect((await attempt({ artifactId: "nope" }))?.status).toBe(422);
    expect(
      (
        await attempt({
          artifactId: plan.artifactId,
          content: "x".repeat(100_001),
        })
      )?.status
    ).toBe(422);
    // Nothing was saved over the plan.
    expect(await listArtifactVersions(h.db, plan.artifactId)).toHaveLength(1);
  });
});

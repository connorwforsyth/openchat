import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import { mockImageModel } from "@workspace/ai/testing/mock-image-model";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { ConversationId, RunId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  CreateRunOutput,
  RunOptions,
} from "@workspace/contract/schemas/runs";
import type { SpaceRef } from "@workspace/contract/schemas/spaces";
import { listArtifacts } from "@workspace/db/queries/artifacts";
import { getRun } from "@workspace/db/queries/runs";
import { setSpaceAllowance } from "@workspace/db/queries/spaces";
import { personalOrgOf } from "@workspace/db/queries/teams";
import {
  listTransactions,
  recordTransaction,
  setBudget,
} from "@workspace/db/queries/usage";
import { expectOk, seedOrg } from "@workspace/db/testing";
import { err, ok } from "@workspace/shared/result";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createHarness, type Harness } from "../testing/harness";
import type { ImageModels } from "./images";
import type { SandboxToolSource } from "./sandbox";

// `generate_image` in real turns (138): offered only with an image model
// this chat can pay for; a call asks first (or not, with `approval: auto`);
// an approved call writes each picture into the workspace, saves it as an
// `image` artifact and records its cost; a planning run never sees it; and
// a spent hard budget or space allowance stops it before anything is drawn.

const MODEL = "test:chat";
const IMAGE_MODEL = "test:pixel";

let h: Harness | undefined;
afterEach(() => h?.close());

const scripted = (
  steps: readonly (() => LanguageModelV4StreamResult)[]
): MockLanguageModelV4 => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const step = steps[calls];
      calls += 1;
      return Promise.resolve(step ? step() : textStream("Done."));
    },
  });
};

const offered = (model: MockLanguageModelV4, call = 0): string[] =>
  (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name);

const imageModels = (pixel = mockImageModel()): ImageModels => ({
  imageModel: () => ok(pixel.model),
  imageModels: () =>
    Promise.resolve([
      { available: true, displayName: "Pixel", target: IMAGE_MODEL },
    ]),
});

/** A workspace held in memory, with one tool so the turn counts it. */
const memoryWorkspace = () => {
  const files = new Map<string, Uint8Array>();
  const source: SandboxToolSource = () =>
    Promise.resolve({
      proposeEdits: () => Promise.resolve(undefined),
      provider: "just-bash",
      readFile: (path) => {
        const bytes = files.get(path);
        return Promise.resolve(
          bytes ? ok(bytes) : err({ type: "not_found" as const })
        );
      },
      tools: {
        bash: tool({
          description: "Run a command.",
          execute: () => Promise.resolve({ status: "ran" }),
          inputSchema: z.object({ command: z.string() }),
        }),
      },
      writeFile: (path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve(ok(undefined));
      },
    });
  return { files, source };
};

const send = async (
  harness: Harness,
  options?: Partial<RunOptions>,
  context?: SpaceRef
): Promise<{ conversationId: ConversationId; runId: RunId }> => {
  const chat = await harness.request("/api/conversations", {
    json: context ? { context } : {},
    method: "POST",
  });
  const conversationId = ((await chat.json()) as Conversation).id;
  const response = await harness.request("/api/runs", {
    json: {
      conversationId,
      input: {
        parentId: null,
        parts: [{ text: "Draw me a lighthouse.", type: "text" }],
        type: "message",
      },
      ...(options ? { options } : {}),
      target: { model: MODEL, type: "model" },
    },
    method: "POST",
  });
  if (response.status !== 202) {
    throw new Error(`expected 202, got ${response.status}`);
  }
  await harness.services.executor.idle();
  return {
    conversationId,
    runId: ((await response.json()) as CreateRunOutput).runId as RunId,
  };
};

const approveAll = async (harness: Harness, runId: RunId) => {
  const run = expectOk(await getRun(harness.db, runId));
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

const draw = () =>
  toolCallStream(
    "generate_image",
    { count: 2, prompt: "A lighthouse at dusk" },
    "g1"
  );

describe("generate_image in a plain chat", () => {
  it("asks, then saves each picture to the workspace and the artifacts, and records its cost", async () => {
    const pixel = mockImageModel();
    const workspace = memoryWorkspace();
    const model = scripted([draw]);
    h = await createHarness({
      images: { models: imageModels(pixel) },
      models: { [MODEL]: model },
      prices: { [IMAGE_MODEL]: { imageMicros: 40_000 } },
      realTurns: true,
      sandbox: () => workspace.source,
    });
    const { conversationId, runId } = await send(h);
    expect(offered(model)).toContain("generate_image");
    expect(expectOk(await getRun(h.db, runId)).status).toBe(
      "awaiting_approval"
    );
    expect(pixel.calls).toEqual([]);

    await approveAll(h, runId);
    expect(expectOk(await getRun(h.db, runId)).status).toBe("succeeded");
    expect(pixel.calls).toHaveLength(1);
    expect([...workspace.files.keys()]).toEqual([
      "images/a-lighthouse-at-dusk-1.png",
      "images/a-lighthouse-at-dusk-2.png",
    ]);
    const artifacts = await listArtifacts(h.db, conversationId);
    expect(artifacts.map((row) => [row.kind, row.title])).toEqual([
      ["image", "A lighthouse at dusk (1)"],
      ["image", "A lighthouse at dusk (2)"],
    ]);
    const spent = expectOk(
      await listTransactions(h.db, h.ownerId, { limit: 10 })
    ).items.filter((row) => row.kind === "tool");
    expect(spent).toMatchObject([
      { costMicros: 80_000, model: IMAGE_MODEL, runId },
    ]);
    // The model read where they went, not the pictures.
    const read = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(read).toContain("Made 2 images with Pixel");
  });

  it("runs without asking when the instance says `auto`", async () => {
    const pixel = mockImageModel();
    h = await createHarness({
      images: { approval: "auto", models: imageModels(pixel) },
      models: { [MODEL]: scripted([draw]) },
      realTurns: true,
      sandbox: () => memoryWorkspace().source,
    });
    const { runId } = await send(h);
    expect(expectOk(await getRun(h.db, runId)).status).toBe("succeeded");
    expect(pixel.calls).toHaveLength(1);
  });

  it("isn't offered without an image model the chat can use", async () => {
    const model = scripted([]);
    h = await createHarness({
      images: {
        models: {
          ...imageModels(),
          imageModels: () =>
            Promise.resolve([
              { available: false, displayName: "Pixel", target: IMAGE_MODEL },
            ]),
        },
      },
      models: { [MODEL]: model },
      realTurns: true,
    });
    await send(h);
    expect(offered(model)).not.toContain("generate_image");
  });

  it("is withheld from a planning run (106)", async () => {
    const pixel = mockImageModel();
    const model = scripted([draw]);
    h = await createHarness({
      images: { approval: "auto", models: imageModels(pixel) },
      models: { [MODEL]: model },
      realTurns: true,
    });
    const { runId } = await send(h, { mode: "plan" });
    for (const call of model.doStreamCalls.keys()) {
      expect(offered(model, call)).not.toContain("generate_image");
    }
    expect(expectOk(await getRun(h.db, runId)).status).toBe("succeeded");
    expect(pixel.calls).toEqual([]);
  });

  it("draws nothing once a hard budget is spent", async () => {
    const pixel = mockImageModel();
    const model = scripted([draw]);
    h = await createHarness({
      images: { approval: "auto", models: imageModels(pixel) },
      models: { [MODEL]: model },
      prices: { [IMAGE_MODEL]: { imageMicros: 40_000 } },
      realTurns: true,
    });
    const orgId = await personalOrgOf(h.db, h.ownerId);
    if (!orgId) {
      throw new Error("no personal org");
    }
    // A spent budget stops a run before it starts, so it's set as the
    // model calls the tool: the run has begun, the call hasn't.
    const harness = h;
    const prompts: unknown[] = [];
    let calls = 0;
    model.doStream = async (options) => {
      prompts.push(options.prompt);
      calls += 1;
      if (calls > 1) {
        return textStream("Done.");
      }
      await setBudget(harness.db, {
        hard: true,
        limitMicros: 0,
        orgId,
        period: "month",
        principal: { id: harness.ownerId, type: "user" },
      });
      return draw();
    };
    await send(h);
    expect(pixel.calls).toEqual([]);
    expect(JSON.stringify(prompts.at(-1))).toContain("budget");
  });

  it("draws nothing once the space's token allowance is spent (192)", async () => {
    const pixel = mockImageModel();
    const model = scripted([draw]);
    h = await createHarness({
      images: { approval: "auto", models: imageModels(pixel) },
      models: { [MODEL]: model },
      realTurns: true,
    });
    const harness = h;
    const orgId = (await seedOrg(harness.db, harness.ownerId)).id;
    const space: SpaceRef = { id: orgId, type: "org" };
    await setSpaceAllowance(harness.db, {
      monthlyTokens: 100,
      orgId,
      space,
      userId: harness.ownerId,
    });
    // As with the budget above, the pool runs dry once the run has begun.
    let calls = 0;
    model.doStream = async () => {
      calls += 1;
      if (calls > 1) {
        return textStream("Done.");
      }
      await recordTransaction(harness.db, {
        context: space,
        costMicros: 0,
        kind: "chat",
        model: MODEL,
        orgId,
        paidBy: { type: "instance" },
        usage: { inputTokens: 100, outputTokens: 0 },
        userId: harness.ownerId,
      });
      return draw();
    };
    await send(h, undefined, space);
    expect(pixel.calls).toEqual([]);
  });
});

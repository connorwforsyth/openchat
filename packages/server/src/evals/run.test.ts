import { textStream } from "@workspace/ai/testing/mock-models";
import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import {
  addEvalCases,
  createEvalDataset,
  createEvalRun,
  getEvalRun,
  listEvalResults,
} from "@workspace/db/queries/evals";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { transaction } from "@workspace/db/schema/usage";
import { expectOk } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enqueueJob } from "../jobs/registry";
import { createHarness, type Harness } from "../testing/harness";
import { casePassed, enqueueEvalRun, scoreEvalCase } from "./run";

// `eval.run` (041): a dataset against an agent version through the job
// queue, scores stored per case and scorer, the tally on the run. The
// agent's model is a mock that answers each case in turn.

const definition: AgentDefinition = {
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "Answer in one word.",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "test:agent",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
};

let h: Harness;
let model: MockLanguageModelV4;

beforeEach(async () => {
  model = new MockLanguageModelV4({
    doStream: [textStream("Paris"), textStream("Berlin"), textStream("Blue")],
  });
  h = await createHarness({ models: { "test:agent": model } });
});

afterEach(() => h.close());

const publishedVersion = async (): Promise<{
  agentId: LibraryItemId;
  versionId: LibraryVersionId;
}> => {
  const { item } = await createVersionedItem(h.db, "agent", {
    createdBy: h.ownerId,
    definition,
    name: "Geographer",
    owner: { id: h.ownerId, type: "user" },
  });
  const published = expectOk(
    await publishDraft(h.db, "agent", item.id as LibraryItemId, {
      publishedBy: h.ownerId,
    })
  );
  return {
    agentId: item.id as LibraryItemId,
    versionId: published.version.id as LibraryVersionId,
  };
};

describe("eval.run", () => {
  it("runs every case against the version and stores the scores", async () => {
    const { agentId, versionId } = await publishedVersion();
    const dataset = await createEvalDataset(h.db, {
      agentId,
      createdBy: h.ownerId,
      name: "Capitals",
    });
    const [france, spain, sky] = await addEvalCases(h.db, dataset.id, [
      { expected: "paris", input: "Capital of France?" },
      {
        expected: { equals: "Madrid" },
        input: { prompt: "Capital of Spain?" },
      },
      { input: "Colour of the sky?", rubric: "Names a colour." },
    ]);

    const run = await enqueueEvalRun(h.jobs, h.db, {
      agentVersionId: versionId,
      createdBy: h.ownerId,
      datasetId: dataset.id,
    });
    expect(run.status).toBe("queued");
    await h.jobs.drain();

    const finished = await getEvalRun(h.db, run.id);
    expect(finished).toMatchObject({
      passed: 1,
      status: "succeeded",
      total: 3,
    });
    expect(finished?.finishedAt).not.toBeNull();

    const results = await listEvalResults(h.db, run.id);
    expect(
      results.map((result) => [result.caseId, result.scorer, result.passed])
    ).toEqual(
      expect.arrayContaining([
        [france?.id, "deterministic:includes", true],
        [spain?.id, "deterministic:equals", false],
        [sky?.id, "llm-judge", null],
      ])
    );
    expect(results).toHaveLength(3);
    // The agent's instructions reached the model.
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(
      "Answer in one word."
    );
    // Its usage is the requester's, like a chat's.
    const spent = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.userId, h.ownerId));
    expect(spent).toHaveLength(3);
  });

  it("fails a run with no one to run it as, without calling a model", async () => {
    const { agentId, versionId } = await publishedVersion();
    const dataset = await createEvalDataset(h.db, {
      agentId,
      createdBy: h.ownerId,
      name: "Orphan",
    });
    await addEvalCases(h.db, dataset.id, [{ expected: "x", input: "x?" }]);
    // The requester's account was deleted after queuing it.
    const run = await createEvalRun(h.db, {
      agentVersionId: versionId,
      createdBy: null,
      datasetId: dataset.id,
    });
    await enqueueJob(h.jobs, "eval.run", { evalRunId: run.id });
    await h.jobs.drain();

    expect(await getEvalRun(h.db, run.id)).toMatchObject({ status: "failed" });
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("scoring", () => {
  const id = "01a0de5f-bf67-7628-9db6-f0c96ff5586c" as never;

  it("checks text containment case-insensitively and exact answers trimmed", () => {
    expect(
      scoreEvalCase({ expected: "PARIS", id, rubric: null }, "It's Paris.")
    ).toMatchObject([{ passed: true, score: 1 }]);
    expect(
      scoreEvalCase({ expected: { equals: "42" }, id, rubric: null }, " 42\n")
    ).toMatchObject([{ passed: true, scorer: "deterministic:equals" }]);
    expect(
      scoreEvalCase({ expected: { equals: "42" }, id, rubric: null }, "41")
    ).toMatchObject([
      { details: { reason: expect.any(String) }, passed: false },
    ]);
  });

  it("passes a case only when something scored it and everything passed", () => {
    expect(casePassed([])).toBe(false);
    expect(
      casePassed(scoreEvalCase({ expected: null, id, rubric: "Kind." }, "x"))
    ).toBe(false);
    expect(
      casePassed(scoreEvalCase({ expected: "x", id, rubric: "Kind." }, "x"))
    ).toBe(true);
  });
});

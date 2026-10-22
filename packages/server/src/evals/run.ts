import { runAgent } from "@workspace/ai/agent/run-agent";
import {
  createJudge,
  type JudgeError,
  type JudgeVerdict,
} from "@workspace/ai/evals/judge";
import { type ModelPrices, usageCost } from "@workspace/config/prices";
import type {
  JsonValue,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type {
  ModelSelector,
  TokenUsage,
} from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import {
  createEvalRun,
  type EvalCaseRow,
  type EvalDatasetId,
  type EvalRunId,
  type EvalRunRow,
  finishEvalRun,
  listEvalCases,
  type NewEvalResult,
  saveEvalResults,
  startEvalRun,
} from "@workspace/db/queries/evals";
import { getVersion } from "@workspace/db/queries/library";
import { recordTransaction } from "@workspace/db/queries/usage";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";
import type { UIMessageChunk } from "ai";
import { z } from "zod";

import { actorFor } from "../context";
import { enqueueJob, type JobHandlers, type Jobs } from "../jobs/registry";
import type { JobQueue } from "../ports/job-queue";
import { fillAgentInstructions } from "../runs/agent-instructions";
import { chargedBy, storeContext } from "../runs/chat-context";
import type { ModelLoader } from "../runs/turn";

// `eval.run` (D21, Agents+ wave): one dataset run against one agent
// version. Each case's input goes to the version's model with its
// instructions and parameters, one turn, no tools (sandbox, MCP and file
// tools need a chat to run in); the answer is scored and every score stored
// in `eval_result`, the tally on `eval_run`. The requester's keys pay, in
// their Personal context, and the usage is recorded there like a chat's.
//
// Scorers follow the dev evals' core (`packages/ai/evals/core/scorers.ts`):
// pass/fail predicates, 1 or 0, with the reason in the details. A case's
// rubric is scored by the LLM judge (`@workspace/ai/evals/judge`, 085) when
// a judge model is configured, and stored unscored otherwise; a judge that
// fails is stored as an error, unscored, never as a pass.

/** A case's input: the user's message, as text or `{ prompt }`. */
export const evalCaseInputSchema = z.union([
  z.string().min(1),
  z.object({ prompt: z.string().min(1) }).transform(({ prompt }) => prompt),
]);

/**
 * What a case expects: text the answer must contain (case-insensitive), or
 * `{ equals }` for the whole answer (trimmed).
 */
export const evalCaseExpectedSchema = z.union([
  z
    .string()
    .min(1)
    .transform((includes) => ({ includes })),
  z.object({ includes: z.string().min(1) }),
  z.object({ equals: z.string() }),
]);

export const LLM_JUDGE_SCORER = "llm-judge";

type Verdict = true | string;

const scored = (
  caseId: EvalCaseRow["id"],
  scorer: string,
  output: string,
  verdict: Verdict
): NewEvalResult => ({
  caseId,
  details: verdict === true ? null : { reason: verdict },
  output,
  passed: verdict === true,
  score: verdict === true ? 1 : 0,
  scorer,
});

/** The judge's verdict on a case's rubric, when a judge was asked. */
export type RubricVerdict = Result<JudgeVerdict, JudgeError>;

const judged = (
  caseId: EvalCaseRow["id"],
  output: string,
  verdict: RubricVerdict | undefined
): NewEvalResult => {
  if (!verdict) {
    return {
      caseId,
      details: { skipped: "the LLM judge isn't available yet" },
      output,
      passed: null,
      score: null,
      scorer: LLM_JUDGE_SCORER,
    };
  }
  return verdict.ok
    ? {
        caseId,
        details: { reasoning: verdict.value.reasoning },
        output,
        passed: verdict.value.pass,
        score: verdict.value.score,
        scorer: LLM_JUDGE_SCORER,
      }
    : {
        caseId,
        details: { error: verdict.error.message, type: verdict.error.type },
        output,
        passed: null,
        score: null,
        scorer: LLM_JUDGE_SCORER,
      };
};

/** The scores for one case's answer. Pure. */
export const scoreEvalCase = (
  item: Pick<EvalCaseRow, "expected" | "id" | "rubric">,
  output: string,
  rubricVerdict?: RubricVerdict
): NewEvalResult[] => {
  const results: NewEvalResult[] = [];
  if (item.expected !== null) {
    const expected = evalCaseExpectedSchema.safeParse(item.expected);
    if (!expected.success) {
      results.push(
        scored(
          item.id,
          "deterministic:expected",
          output,
          "the case's expected value isn't text, { includes } or { equals }"
        )
      );
    } else if ("equals" in expected.data) {
      const want = expected.data.equals.trim();
      results.push(
        scored(
          item.id,
          "deterministic:equals",
          output,
          output.trim() === want || `expected exactly ${JSON.stringify(want)}`
        )
      );
    } else {
      const want = expected.data.includes;
      results.push(
        scored(
          item.id,
          "deterministic:includes",
          output,
          output.toLowerCase().includes(want.toLowerCase()) ||
            `expected the answer to contain ${JSON.stringify(want)}`
        )
      );
    }
  }
  if (item.rubric) {
    results.push(judged(item.id, output, rubricVerdict));
  }
  return results;
};

/** A case passes when it was scored and every score passed. Pure. */
export const casePassed = (results: readonly NewEvalResult[]): boolean => {
  const decided = results.filter((result) => result.passed !== null);
  return decided.length > 0 && decided.every((result) => result.passed);
};

export interface EvalJobDeps {
  readonly db: Db;
  /** Judges rubric cases, paid like the answers; without one they're stored unscored. */
  readonly judgeModel?: ModelSelector;
  readonly loadModel: ModelLoader;
  readonly now?: () => Date;
  /** `models.prices`, to cost each case's usage; without it every case costs 0. */
  readonly prices?: ModelPrices;
  readonly report?: (message: string, cause: unknown) => void;
}

const textOf = (chunks: readonly UIMessageChunk[]): string =>
  chunks
    .flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
    .join("");

const drain = async (
  stream: ReadableStream<UIMessageChunk>
): Promise<UIMessageChunk[]> => {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<UIMessageChunk>) {
    chunks.push(chunk);
  }
  return chunks;
};

type CaseAnswer =
  | { readonly ok: true; readonly text: string; readonly usage: TokenUsage }
  | { readonly message: string; readonly ok: false };

export const createEvalJobHandlers = (deps: EvalJobDeps): JobHandlers => {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const report = deps.report ?? (() => undefined);

  const fail = async (run: EvalRunRow, reason: string) => {
    await finishEvalRun(
      db,
      run.id,
      { passed: null, status: "failed", total: null },
      now()
    );
    return ok({ failed: reason });
  };

  const recordUsage = async (
    userId: UserId,
    model: string,
    usage: TokenUsage
  ) => {
    const actor = await actorFor(db, { userId });
    const context = await storeContext(db, actor, { type: "personal" });
    const charged = context.ok
      ? await chargedBy(db, userId, context.value)
      : null;
    if (!(context.ok && charged)) {
      return;
    }
    await recordTransaction(db, {
      context: context.value,
      costMicros: usageCost(deps.prices ?? {}, model, usage).costMicros,
      kind: "chat",
      model,
      orgId: charged.orgId,
      paidBy: { type: "instance" },
      usage,
      userId,
    });
  };

  const answer = async (
    definition: AgentDefinition,
    model: Parameters<typeof runAgent>[0]["model"],
    prompt: string,
    signal: AbortSignal
  ): Promise<CaseAnswer> => {
    const started = await runAgent({
      instructions: definition.instructions,
      messages: [
        {
          id: newId("message"),
          parts: [{ text: prompt, type: "text" }],
          role: "user",
        },
      ],
      model,
      parameters: definition.parameters,
      signal,
    });
    if (!started.ok) {
      return { message: started.error.message, ok: false };
    }
    const chunks = await drain(started.value.stream);
    const outcome = await started.value.outcome;
    return outcome.status === "succeeded"
      ? { ok: true, text: textOf(chunks), usage: outcome.usage }
      : {
          message:
            outcome.status === "failed"
              ? outcome.error.message
              : `the turn ended ${outcome.status}`,
          ok: false,
        };
  };

  /** The judge's verdict on an answer's rubric; `undefined` without a rubric or a judge model. */
  const judgeRubric = async (
    userId: UserId,
    rubric: string | null,
    prompt: string,
    text: string,
    signal: AbortSignal
  ): Promise<RubricVerdict | undefined> => {
    if (!(rubric && deps.judgeModel)) {
      return;
    }
    const loaded = await deps.loadModel(
      { context: { type: "personal" }, userId },
      deps.judgeModel,
      { signal, state: { facts: {}, history: [], input: prompt } }
    );
    if (!loaded.ok) {
      return err({ message: loaded.error.message, type: "unavailable" });
    }
    const verdict = await createJudge({ model: loaded.value.model }).judge({
      criteria: rubric,
      signal,
      transcript: [{ message: prompt, reply: text }],
    });
    if (verdict.ok) {
      const { inputTokens = 0, outputTokens = 0 } = verdict.value.usage;
      await recordUsage(userId, loaded.value.resolvedModel, {
        inputTokens,
        outputTokens,
      }).catch((cause: unknown) =>
        report("couldn't record judge usage", cause)
      );
    }
    return verdict;
  };

  const runCases = async (
    run: EvalRunRow,
    userId: UserId,
    definition: AgentDefinition,
    signal: AbortSignal
  ) => {
    const cases = await listEvalCases(db, run.datasetId);
    // Filled once per run, as a chat fills them once per turn.
    const agent = {
      ...definition,
      instructions: await fillAgentInstructions(
        db,
        userId,
        definition.instructions,
        now
      ),
    };
    let passed = 0;
    for (const item of cases) {
      if (signal.aborted) {
        return fail(run, "cancelled");
      }
      const input = evalCaseInputSchema.safeParse(item.input);
      if (!input.success) {
        // biome-ignore lint/performance/noAwaitInLoops: cases run one at a time, like a person would.
        await saveEvalResults(db, run.id, [
          {
            caseId: item.id,
            details: { reason: "the case's input isn't text or { prompt }" },
            passed: false,
            score: 0,
            scorer: "deterministic:input",
          },
        ]);
        continue;
      }
      // A fresh model per case: the key is resolved again, so a revoked one stops the run.
      const loaded = await deps.loadModel(
        { context: { type: "personal" }, userId },
        definition.model,
        { signal, state: { facts: {}, history: [], input: input.data } }
      );
      if (!loaded.ok) {
        return fail(run, loaded.error.message);
      }
      const reply = await answer(agent, loaded.value.model, input.data, signal);
      if (reply.ok) {
        await recordUsage(
          userId,
          loaded.value.resolvedModel,
          reply.usage
        ).catch((cause: unknown) =>
          report("couldn't record eval usage", cause)
        );
      }
      const results = reply.ok
        ? scoreEvalCase(
            item,
            reply.text,
            await judgeRubric(
              userId,
              item.rubric,
              input.data,
              reply.text,
              signal
            )
          )
        : [
            {
              caseId: item.id,
              details: { reason: reply.message },
              output: null as JsonValue,
              passed: false,
              score: 0,
              scorer: "deterministic:answered",
            },
          ];
      await saveEvalResults(db, run.id, results);
      passed += casePassed(results) ? 1 : 0;
    }
    await finishEvalRun(
      db,
      run.id,
      { passed, status: "succeeded", total: cases.length },
      now()
    );
    return ok({ passed, total: cases.length });
  };

  return {
    "eval.run": async (job, signal) => {
      const run = await startEvalRun(
        db,
        job.data.evalRunId as EvalRunId,
        now()
      );
      if (!run) {
        return ok({ skipped: "not_runnable" });
      }
      try {
        const version = await getVersion(
          db,
          "agent",
          run.agentVersionId as LibraryVersionId
        );
        if (!version.ok) {
          return await fail(run, "the agent version is gone");
        }
        if (!run.createdBy) {
          return await fail(run, "no one to run it as");
        }
        return await runCases(
          run,
          run.createdBy,
          version.value.definition,
          signal
        );
      } catch (cause) {
        report("eval run crashed", cause);
        await fail(run, "crashed").catch(() => undefined);
        return err("eval run crashed");
      }
    },
  };
};

/** Queues a run of `datasetId` against an agent version; the job does the rest. */
export const enqueueEvalRun = async (
  queue: JobQueue<Jobs>,
  db: Db,
  input: {
    readonly agentVersionId: LibraryVersionId;
    readonly createdBy: UserId;
    readonly datasetId: EvalDatasetId;
  }
): Promise<EvalRunRow> => {
  const run = await createEvalRun(db, input);
  const queued = await enqueueJob(queue, "eval.run", { evalRunId: run.id });
  if (!queued.ok) {
    await finishEvalRun(
      db,
      run.id,
      { passed: null, status: "failed", total: null },
      new Date()
    );
  }
  return run;
};

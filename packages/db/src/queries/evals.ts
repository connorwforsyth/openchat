import type {
  JsonValue,
  LibraryItemId,
  LibraryVersionId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Id } from "@workspace/shared/ids";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { Db } from "../client";
import {
  type EVAL_RUN_STATUSES,
  evalCase,
  evalDataset,
  evalResult,
  evalRun,
} from "../schema/quality";

// Agent evals (D21, Agents+ wave): a dataset of cases, runs of a dataset
// against one agent version, and a result per case per scorer. The
// `eval.run` job moves a run `queued` → `running` → `succeeded | failed`;
// results are upserted, so a retried job overwrites rather than duplicates.

export type EvalDatasetRow = typeof evalDataset.$inferSelect;
export type EvalCaseRow = typeof evalCase.$inferSelect;
export type EvalRunRow = typeof evalRun.$inferSelect;
export type EvalResultRow = typeof evalResult.$inferSelect;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

export type EvalDatasetId = Id<"evalDataset">;
export type EvalCaseId = Id<"evalCase">;
export type EvalRunId = Id<"evalRun">;

export const createEvalDataset = async (
  db: Db,
  input: {
    readonly agentId: LibraryItemId;
    readonly createdBy: UserId | null;
    readonly name: string;
  }
): Promise<EvalDatasetRow> => {
  const [row] = await db.insert(evalDataset).values(input).returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export interface NewEvalCase {
  readonly expected?: JsonValue | null;
  readonly input: JsonValue;
  readonly rubric?: string | null;
  readonly sourceMessageId?: MessageId | null;
}

export const addEvalCases = (
  db: Db,
  datasetId: EvalDatasetId,
  cases: readonly NewEvalCase[]
): Promise<EvalCaseRow[]> =>
  cases.length === 0
    ? Promise.resolve([])
    : db
        .insert(evalCase)
        .values(cases.map((item) => ({ ...item, datasetId })))
        .returning();

/** A dataset's cases, oldest first (the order they were written in). */
export const listEvalCases = (
  db: Db,
  datasetId: EvalDatasetId
): Promise<EvalCaseRow[]> =>
  db
    .select()
    .from(evalCase)
    .where(eq(evalCase.datasetId, datasetId))
    .orderBy(asc(evalCase.createdAt), asc(evalCase.id));

export const getEvalDataset = async (
  db: Db,
  id: EvalDatasetId
): Promise<EvalDatasetRow | null> => {
  const [row] = await db
    .select()
    .from(evalDataset)
    .where(eq(evalDataset.id, id));
  return row ?? null;
};

/** A queued run of `datasetId` against one agent version. */
export const createEvalRun = async (
  db: Db,
  input: {
    readonly agentVersionId: LibraryVersionId;
    readonly createdBy: UserId | null;
    readonly datasetId: EvalDatasetId;
  }
): Promise<EvalRunRow> => {
  const [row] = await db
    .insert(evalRun)
    .values({ ...input, status: "queued" })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export const getEvalRun = async (
  db: Db,
  id: EvalRunId
): Promise<EvalRunRow | null> => {
  const [row] = await db.select().from(evalRun).where(eq(evalRun.id, id));
  return row ?? null;
};

/**
 * Claims a run for execution. A queued run starts; a `running` one is
 * taken over too, since only a retried job (its worker died) finds it so.
 * `null` once it has finished or was cancelled.
 */
export const startEvalRun = async (
  db: Db,
  id: EvalRunId,
  now: Date = new Date()
): Promise<EvalRunRow | null> => {
  const current = await getEvalRun(db, id);
  if (!(current?.status === "queued" || current?.status === "running")) {
    return null;
  }
  const [row] = await db
    .update(evalRun)
    .set({ startedAt: now, status: "running" })
    .where(and(eq(evalRun.id, id), eq(evalRun.status, current.status)))
    .returning();
  return row ?? null;
};

/** Settles a run that hasn't settled yet (one that never started can fail too). */
export const finishEvalRun = async (
  db: Db,
  id: EvalRunId,
  outcome: {
    readonly passed: number | null;
    readonly status: Extract<EvalRunStatus, "failed" | "succeeded">;
    readonly total: number | null;
  },
  now: Date = new Date()
): Promise<EvalRunRow | null> => {
  const [row] = await db
    .update(evalRun)
    .set({ ...outcome, finishedAt: now })
    .where(
      and(eq(evalRun.id, id), inArray(evalRun.status, ["queued", "running"]))
    )
    .returning();
  return row ?? null;
};

export interface NewEvalResult {
  readonly caseId: EvalCaseId;
  readonly details?: JsonValue | null;
  readonly output?: JsonValue | null;
  readonly passed: boolean | null;
  readonly score: number | null;
  /** `deterministic:<name>`, `llm-judge`, `decider`. */
  readonly scorer: string;
}

/** Stores one case's scores; a retried job's scores replace the earlier ones. */
export const saveEvalResults = async (
  db: Db,
  runId: EvalRunId,
  results: readonly NewEvalResult[]
): Promise<void> => {
  for (const result of results) {
    const values = {
      details: result.details ?? null,
      output: result.output ?? null,
      passed: result.passed,
      score: result.score,
    };
    // biome-ignore lint/performance/noAwaitInLoops: a handful of scorers per case; each upsert names its own conflict target.
    await db
      .insert(evalResult)
      .values({
        ...values,
        caseId: result.caseId,
        runId,
        scorer: result.scorer,
      })
      .onConflictDoUpdate({
        set: values,
        target: [evalResult.runId, evalResult.caseId, evalResult.scorer],
      });
  }
};

export const listEvalResults = (
  db: Db,
  runId: EvalRunId
): Promise<EvalResultRow[]> =>
  db
    .select()
    .from(evalResult)
    .where(eq(evalResult.runId, runId))
    .orderBy(asc(evalResult.createdAt), asc(evalResult.id));

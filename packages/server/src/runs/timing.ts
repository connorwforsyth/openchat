import { type RunId, runIdSchema } from "@workspace/contract/schemas/common";
import { z } from "zod";

// Server timing marks on a run's way to its first token (ticket 102,
// D27 "measure from the first byte"). Each mark is the moment a phase
// ended, on the process's monotonic clock, so the time a phase took is the
// gap since the mark before it. They're for measuring, not behaviour: the
// shell decides where they go (the e2e suite writes them to a file), and
// with no sink nothing is recorded.

export const runPhaseSchema = z.enum([
  /** `POST /runs` arrived. */
  "run.received",
  /** The conversation, access, target, context and budget were checked. */
  "run.checked",
  /** The user message and the run were stored. */
  "run.placed",
  /** The executor claimed it (its empty answer inserted). */
  "run.started",
  /** The branch the run answers was loaded. */
  "turn.branch",
  /** The agent's version (or draft) was loaded and access re-checked. */
  "turn.agent",
  /** The target resolved to a model and the key that pays for it. */
  "turn.model",
  /** The chat's workspace tools were bound (a workspace starts lazily). */
  "turn.workspace",
  /** The agent's tools were planned and built, MCP servers connected. */
  "turn.tools",
  /** The retrieval gate (the Decider) ran on the final text. */
  "turn.gate",
  /** `@file` mentions were read from the workspace. */
  "turn.mentions",
  /** The turn resolver returned, chat memory included. */
  "turn.resolved",
  /** The agent loop started: the provider request is on its way. */
  "agent.called",
  /** The provider's first text arrived. */
  "agent.first-text",
  /** A client's stream request passed its checks and subscribed. */
  "stream.opened",
]);
export type RunPhase = z.infer<typeof runPhaseSchema>;

export const runMarkSchema = z.object({
  /** `performance.now()` in the server process. */
  at: z.number(),
  phase: runPhaseSchema,
  runId: runIdSchema,
});
export type RunMark = z.infer<typeof runMarkSchema>;

/** Where marks go. Must not throw, and must not block the run. */
export type RunTimings = (mark: RunMark) => void;

/** Records `phase` for `runId` now, when there's a sink. */
export const markRun = (
  timings: RunTimings | undefined,
  runId: RunId,
  phase: RunPhase,
  at: number = performance.now()
): void => {
  timings?.({ at, phase, runId });
};

/**
 * Marks taken before the run has an id (`createRun` checks before it
 * stores), recorded once it has one.
 */
export const pendingMarks = (timings: RunTimings | undefined) => {
  const held: { readonly at: number; readonly phase: RunPhase }[] = [];
  return {
    flush: (runId: RunId) => {
      for (const { at, phase } of held) {
        markRun(timings, runId, phase, at);
      }
      held.length = 0;
    },
    mark: (phase: RunPhase) => {
      if (timings) {
        held.push({ at: performance.now(), phase });
      }
    },
  };
};

import { answeringAgent, chipsOf } from "@workspace/ai/messages/chips";
import type { SkillUse } from "@workspace/ai/messages/skills";
import type { RunExecutor } from "@workspace/ai/ports/run-executor";
import type { MessageId, RunId } from "@workspace/contract/schemas/common";
import type { ModelSelector } from "@workspace/contract/schemas/models";
import {
  type CreateRunInput,
  type CreateRunOutput,
  type RunTarget,
  runOptionsSchema,
} from "@workspace/contract/schemas/runs";
import type { Db } from "@workspace/db/client";
import { getArtifact } from "@workspace/db/queries/artifacts";
import {
  type ConversationView,
  getConversation,
  type StoredContext,
  setConversationContext,
} from "@workspace/db/queries/conversations";
import { getMessage, insertMessage } from "@workspace/db/queries/messages";
import {
  approvalIdsOf,
  getRun,
  createRun as insertRun,
  listActiveRuns,
  type RunRow,
  stoppedRunAt,
} from "@workspace/db/queries/runs";
import type { RunUnattended } from "@workspace/db/schema/chat";
import { err, ok, type Result } from "@workspace/shared/result";
import { TransactionRollbackError } from "drizzle-orm";

import type { Actor } from "../context";
import { canUseLibraryItem } from "../library/router";
import {
  type BudgetCheck,
  type SpendRefusal,
  storeContext,
} from "./chat-context";
import { canEditAgent, draftFor } from "./drafts";
import { pinPlanApproval } from "./plan-artifact";
import { isPlanKind, PLAN_APPROVAL_DATA, planApprovalOf } from "./plan-mode";
import { partsWithSkills, resolvePickedSkills } from "./skills";
import { runStartFromRow } from "./state";

// `POST /api/runs` (PLAN.md §8 steps 1–2): check, persist the user message,
// create the run, and hand it to the executor, or queue it behind the run
// already answering on that branch (one run per branch, D25). Returns at
// once; the answer streams from `streamUrl`.

export type CreateRunError =
  | { readonly type: "not_found" }
  | { readonly type: "forbidden" }
  | { readonly type: "context_locked" }
  | {
      readonly message: string;
      readonly path: string[];
      readonly type: "invalid";
    }
  | SpendRefusal
  | { readonly type: "no_model" };

export interface CreateRunDeps {
  readonly budget: BudgetCheck;
  readonly db: Db;
  /** `models.default` from app.config.yaml: the target when neither the run nor the chat names one. */
  readonly defaultModel: ModelSelector | null;
  readonly executor: RunExecutor;
}

export const streamUrlFor = (runId: RunId): string =>
  `/api/runs/${runId}/stream`;

const sameContext = (a: StoredContext, b: StoredContext): boolean =>
  a.type === b.type && a.id === b.id;

/** `first`, then forward along `afterRunId` to the last active run queued behind it. */
const lastInLine = (
  active: readonly RunRow[],
  first: RunRow | undefined
): RunRow | undefined => {
  let tail = first;
  const seen = new Set<RunId>();
  while (tail && !seen.has(tail.id)) {
    seen.add(tail.id);
    const current: RunRow = tail;
    const next = active.find((run) => run.afterRunId === current.id);
    if (!next) {
      break;
    }
    tail = next;
  }
  return tail;
};

/**
 * The run already answering where this turn lands, and the last run queued
 * behind it: a new turn waits for that one. `anchor` is the message the turn
 * follows (the new message's parent, or the user message being answered
 * again).
 */
export const busyTail = (
  active: readonly RunRow[],
  anchor: MessageId | null
): RunRow | undefined =>
  anchor === null
    ? undefined
    : lastInLine(
        active,
        active.find(
          (run) =>
            run.userMessageId === anchor || run.assistantMessageId === anchor
        )
      );

/**
 * The agent a message's `@agent` chip asks to answer it, which wins over
 * the composer's target for that message; a regenerate reads the chips of
 * the message it answers again. Access is checked like any target's.
 */
const chippedAgent = async (
  db: Db,
  { input: turn }: CreateRunInput
): Promise<RunTarget | undefined> => {
  let parts = turn.type === "message" ? turn.parts : undefined;
  if (turn.type === "regenerate") {
    const answered = await getMessage(db, turn.userMessageId);
    parts = answered.ok ? answered.value.parts : undefined;
  }
  const agent = parts ? answeringAgent(chipsOf(parts)) : undefined;
  return agent
    ? {
        id: agent.id,
        type: "agent",
        ...(agent.versionId ? { versionId: agent.versionId } : {}),
      }
    : undefined;
};

const targetFor = (
  input: CreateRunInput,
  conversation: ConversationView,
  defaultModel: ModelSelector | null,
  chipped: RunTarget | undefined
): RunTarget | null => {
  if (chipped) {
    return chipped;
  }
  if (input.target) {
    return input.target;
  }
  if (conversation.defaultTarget) {
    return conversation.defaultTarget;
  }
  return defaultModel ? { model: defaultModel, type: "model" } : null;
};

/** The conversation's context, or the one this run sets while it's still unlocked. */
const settleContext = async (
  deps: CreateRunDeps,
  actor: Actor,
  input: CreateRunInput,
  conversation: ConversationView
): Promise<Result<StoredContext, CreateRunError>> => {
  const current = {
    id: conversation.contextId,
    type: conversation.contextType,
  } as StoredContext;
  if (!input.context) {
    return ok(current);
  }
  const wanted = await storeContext(deps.db, actor, input.context);
  if (!wanted.ok) {
    return err({
      message:
        wanted.error.type === "no_personal_space"
          ? "You have no personal space yet."
          : "You aren't a member of that context.",
      path: ["context"],
      type: "invalid",
    });
  }
  if (sameContext(wanted.value, current)) {
    return ok(current);
  }
  const set = await setConversationContext(
    deps.db,
    conversation.id,
    wanted.value
  );
  if (!set.ok) {
    return err(
      set.error.type === "conflict"
        ? { type: "context_locked" }
        : { type: "not_found" }
    );
  }
  return ok(wanted.value);
};

interface Placed {
  readonly created: boolean;
  readonly run: RunRow;
}

/** A regenerate must answer a user message in this conversation. */
const checkRegenerate = async (
  db: Db,
  conversationId: ConversationView["id"],
  { input: turn }: CreateRunInput
): Promise<Result<void, CreateRunError>> => {
  if (turn.type !== "regenerate") {
    return ok(undefined);
  }
  const answered = await getMessage(db, turn.userMessageId);
  return answered.ok &&
    answered.value.conversationId === conversationId &&
    answered.value.role === "user"
    ? ok(undefined)
    : err({
        message: "That isn't a user message in this conversation.",
        path: ["input", "userMessageId"],
        type: "invalid",
      });
};

const badApproval = (message: string): CreateRunError => ({
  message,
  path: ["input", "parts"],
  type: "invalid",
});

/**
 * A message approving a plan (106) must name a plan in this conversation:
 * a markdown artifact here, with at most one approval and edits no longer
 * than a plan may be.
 */
const checkPlanApproval = async (
  db: Db,
  conversationId: ConversationView["id"],
  { input: turn }: CreateRunInput
): Promise<Result<void, CreateRunError>> => {
  if (turn.type !== "message") {
    return ok(undefined);
  }
  const approvals = turn.parts.filter(
    (part) => part.type === "data" && part.name === PLAN_APPROVAL_DATA
  );
  if (approvals.length === 0) {
    return ok(undefined);
  }
  const approval = planApprovalOf(turn.parts);
  if (approvals.length > 1 || !approval) {
    return err(badApproval("That isn't a plan approval."));
  }
  const plan = await getArtifact(db, approval.artifactId);
  return plan.ok &&
    plan.value.conversationId === conversationId &&
    isPlanKind(plan.value.kind)
    ? ok(undefined)
    : err(badApproval("That plan isn't in this conversation."));
};

/**
 * The skills picked for a new message (127): each must be one the sender
 * may use, with a published version. A regenerate reuses its message's.
 */
const checkSkills = async (
  db: Db,
  actor: Actor,
  { input: turn }: CreateRunInput
): Promise<Result<readonly SkillUse[], CreateRunError>> => {
  if (turn.type !== "message" || !turn.skills?.length) {
    return ok([]);
  }
  const resolved = await resolvePickedSkills(db, actor.userId, turn.skills);
  return resolved.ok
    ? resolved
    : err({
        message: resolved.error.message,
        path: ["input", "skills", String(resolved.error.index)],
        type: "invalid",
      });
};

/**
 * What the turn's input names must be right: the message a regenerate
 * answers, a plan approval, the skills picked (127, resolved for storing).
 */
const checkTurn = async (
  db: Db,
  actor: Actor,
  conversationId: ConversationView["id"],
  input: CreateRunInput
): Promise<Result<readonly SkillUse[], CreateRunError>> => {
  const regenerating = await checkRegenerate(db, conversationId, input);
  if (!regenerating.ok) {
    return regenerating;
  }
  const approving = await checkPlanApproval(db, conversationId, input);
  if (!approving.ok) {
    return approving;
  }
  return await checkSkills(db, actor, input);
};

/**
 * Persists the turn and its run in one transaction, queued behind the
 * branch's busy run if there is one. `undefined` when the message it
 * follows isn't in the conversation. A retried idempotency key returns the
 * first run and rolls this attempt's message back.
 */
const placeRun = async (
  db: Db,
  actor: Actor,
  input: CreateRunInput,
  resolved: {
    readonly agentDraft: boolean;
    readonly context: StoredContext;
    /** The message's picked skills, checked (127). */
    readonly skills: readonly SkillUse[];
    readonly target: RunTarget;
    readonly unattended: RunUnattended | null;
  }
): Promise<Placed | undefined> => {
  const { conversationId, input: turn } = input;
  const anchor = turn.type === "message" ? turn.parentId : turn.userMessageId;
  let placed: Placed | undefined;
  try {
    placed = await db.transaction(async (tx) => {
      // A question stopped while it was queued never got an answer, so a
      // reply under it waits on its place in the queue, under that question.
      let tail = busyTail(await listActiveRuns(tx, conversationId), anchor);
      if (!tail && anchor !== null) {
        tail = await stoppedRunAt(tx, conversationId, anchor);
      }
      let userMessageId: MessageId = anchor as MessageId;
      if (turn.type === "message") {
        // A turn sent while the branch is busy follows the answer being
        // written. With a chain of queued turns the last one has no answer
        // yet, so the new message follows its question instead.
        const inserted = await insertMessage(tx, {
          authorId: actor.userId,
          conversationId,
          parentId: tail
            ? (tail.assistantMessageId ?? tail.userMessageId)
            : turn.parentId,
          parts: partsWithSkills(turn.parts, resolved.skills),
          role: "user",
        });
        if (!inserted.ok) {
          return tx.rollback();
        }
        userMessageId = inserted.value.id;
      }
      const created = await insertRun(tx, {
        afterRunId: tail?.id ?? null,
        agentDraft: resolved.agentDraft,
        context: resolved.context,
        conversationId,
        createdBy: actor.userId,
        idempotencyKey: input.idempotencyKey ?? null,
        options: runOptionsSchema.parse(input.options ?? {}),
        status: "queued",
        target: resolved.target,
        unattended: resolved.unattended,
        userMessageId,
      });
      if (!created.created) {
        placed = created;
        tx.rollback();
      }
      return created;
    });
  } catch (cause) {
    if (!(cause instanceof TransactionRollbackError)) {
      throw cause;
    }
  }
  return placed;
};

/**
 * Whether a run's answer is waiting on someone's decision: it has paused,
 * or its stream has asked about a call nobody has decided yet (133). The
 * card goes out while the pass is still running, and the run only pauses
 * once that pass settles, so a person can answer a card on screen before
 * then. A resumed pass has every card it showed decided (stored with the
 * resume), so it counts again only once it asks again.
 */
const waitsOnSomeone = async (db: Db, run: RunRow): Promise<boolean> => {
  if (run.status === "awaiting_approval") {
    return true;
  }
  if (run.status !== "running" || !run.assistantMessageId) {
    return false;
  }
  const asked = await approvalIdsOf(db, run.id);
  if (asked.size === 0) {
    return false;
  }
  const answer = await getMessage(db, run.assistantMessageId);
  const decided = new Set(
    answer.ok
      ? answer.value.parts.flatMap((part) =>
          part.type === "tool-call" && part.approval.state === "decided"
            ? [part.toolCallId]
            : []
        )
      : []
  );
  return [...asked.keys()].some((toolCallId) => !decided.has(toolCallId));
};

/**
 * The last active run in line ahead of a run that ended before it ran,
 * through any others that also ended before they ran.
 */
const waitedOn = async (
  db: Db,
  active: readonly RunRow[],
  stopped: RunRow
): Promise<RunRow | undefined> => {
  let ahead = stopped.afterRunId;
  const seen = new Set<RunId>();
  while (ahead && !seen.has(ahead)) {
    seen.add(ahead);
    const id = ahead;
    const live = active.find((run) => run.id === id);
    if (live) {
      return lastInLine(active, live);
    }
    // biome-ignore lint/performance/noAwaitInLoops: each hop names the next; normally there's one.
    const ended = await getRun(db, id);
    if (!ended.ok || ended.value.assistantMessageId) {
      return;
    }
    ahead = ended.value.afterRunId;
  }
};

/**
 * A turn sent while the answer it follows waits on approvals moves on
 * without them (072): that answer stops as Stop would stop it, and its
 * pending changes are never applied. Queued behind it instead, the turn
 * would wait for as long as nobody decides, since nothing expires a pause.
 * Someone who may send here may already press Stop, so this grants
 * nothing new. A turn sent while the answer is still being written, before
 * any card, queues as usual (D25).
 */
const moveOnFromWaiting = async (
  deps: CreateRunDeps,
  actor: Actor,
  { conversationId, input: turn }: CreateRunInput
): Promise<void> => {
  const anchor = turn.type === "message" ? turn.parentId : turn.userMessageId;
  const active = await listActiveRuns(deps.db, conversationId);
  let tail = busyTail(active, anchor);
  if (!tail && anchor !== null) {
    // Under a question stopped while it was queued, the turn follows what
    // that question waited on, as a reply under that answer would.
    const stopped = await stoppedRunAt(deps.db, conversationId, anchor);
    tail = stopped && (await waitedOn(deps.db, active, stopped));
  }
  if (tail && (await waitsOnSomeone(deps.db, tail))) {
    // A decision that resumed it a moment ago doesn't save it: the cancel
    // stops that pass too.
    await deps.executor.cancel(tail.id, actor.userId);
  }
};

/**
 * Whether `actor` may answer with `target`: any model; an agent's published
 * version when they may `use` it (032); its draft (`draft: true`) only when
 * they may `edit` it (033).
 */
export const mayRun = async (
  db: Db,
  actor: Pick<Actor, "userId">,
  target: RunTarget,
  options: { readonly draft?: boolean } = {}
): Promise<boolean> => {
  if (target.type === "model") {
    return true;
  }
  return options.draft
    ? await canEditAgent(db, actor.userId, target.id)
    : await canUseLibraryItem(db, actor.userId, "agent", target.id);
};

const startRun = async (
  deps: CreateRunDeps,
  actor: Actor,
  input: CreateRunInput,
  unattended: RunUnattended | null
): Promise<Result<CreateRunOutput, CreateRunError>> => {
  const { db } = deps;
  const found = await getConversation(db, input.conversationId, actor);
  if (!found.ok) {
    return err({ type: "not_found" });
  }
  const conversation = found.value;
  if (
    conversation.myPermission !== "owner" &&
    conversation.myPermission !== "editor"
  ) {
    return err({ type: "forbidden" });
  }
  const target = targetFor(
    input,
    conversation,
    deps.defaultModel,
    await chippedAgent(db, input)
  );
  if (!target) {
    return err({ type: "no_model" });
  }
  // An agent's draft runs only for its editors (033); anything else an
  // agent answers with takes `use` (032): knowing its id isn't leave to run
  // it (D13), and a chat's default agent is its owner's choice, not a share
  // of the agent. `NOT_FOUND` either way, like the library, so ids and
  // drafts don't leak.
  const draft = await draftFor(db, actor.userId, target);
  if (
    !draft.ok ||
    (draft.value === null && !(await mayRun(db, actor, target)))
  ) {
    return err({ type: "not_found" });
  }
  const context = await settleContext(deps, actor, input, conversation);
  if (!context.ok) {
    return context;
  }
  const budget = await deps.budget(actor, context.value);
  if (!budget.ok) {
    return err(budget.error);
  }

  const skills = await checkTurn(db, actor, conversation.id, input);
  if (!skills.ok) {
    return skills;
  }
  await moveOnFromWaiting(deps, actor, input);
  const placed = await placeRun(db, actor, input, {
    agentDraft: draft.value !== null,
    context: context.value,
    skills: skills.value,
    target,
    unattended,
  });
  if (!placed) {
    return err({
      message: "The message to answer isn't in this conversation.",
      path: ["input", "parentId"],
      type: "invalid",
    });
  }

  let { run } = placed;
  if (placed.created && input.input.type === "message") {
    // Before the run starts, so its turn reads the version approved.
    await pinPlanApproval(db, {
      conversationId: run.conversationId,
      id: run.userMessageId,
      parts: input.input.parts,
    });
  }
  if (placed.created) {
    const started = await deps.executor.start(runStartFromRow(run));
    if (started.ok) {
      const state = await deps.executor.getState(run.id);
      if (state.ok) {
        run = { ...run, status: state.value.status };
      }
    }
  }
  return ok({
    conversationId: run.conversationId,
    runId: run.id,
    status: run.status,
    streamUrl: streamUrlFor(run.id),
    userMessageId: run.userMessageId,
  });
};

export const createRun = (
  deps: CreateRunDeps,
  actor: Actor,
  input: CreateRunInput
): Promise<Result<CreateRunOutput, CreateRunError>> =>
  startRun(deps, actor, input, null);

/** A run nobody watches: only the schedules engine and a Dot's check-in start one. */
export const createUnattendedRun = (
  deps: CreateRunDeps,
  actor: Actor,
  input: CreateRunInput,
  unattended: RunUnattended
): Promise<Result<CreateRunOutput, CreateRunError>> =>
  startRun(deps, actor, input, unattended);

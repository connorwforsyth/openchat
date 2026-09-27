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
import {
  type ConversationView,
  getConversation,
  type StoredContext,
  setConversationContext,
} from "@workspace/db/queries/conversations";
import { getMessage, insertMessage } from "@workspace/db/queries/messages";
import {
  createRun as insertRun,
  listActiveRuns,
  type RunRow,
} from "@workspace/db/queries/runs";
import { err, ok, type Result } from "@workspace/shared/result";
import { TransactionRollbackError } from "drizzle-orm";

import type { Actor } from "../context";
import { canUseLibraryItem } from "../library/router";
import {
  type BudgetCheck,
  type BudgetExceededData,
  storeContext,
} from "./chat-context";
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
  | { readonly data: BudgetExceededData; readonly type: "budget_exceeded" }
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

/**
 * The run already answering where this turn lands, and the last run queued
 * behind it: a new turn waits for that one. `anchor` is the message the turn
 * follows (the new message's parent, or the user message being answered
 * again).
 */
export const busyTail = (
  active: readonly RunRow[],
  anchor: MessageId | null
): RunRow | undefined => {
  if (anchor === null) {
    return;
  }
  let tail = active.find(
    (run) => run.userMessageId === anchor || run.assistantMessageId === anchor
  );
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

const targetFor = (
  input: CreateRunInput,
  conversation: ConversationView,
  defaultModel: ModelSelector | null
): RunTarget | null => {
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
  resolved: { readonly context: StoredContext; readonly target: RunTarget }
): Promise<Placed | undefined> => {
  const { conversationId, input: turn } = input;
  const anchor = turn.type === "message" ? turn.parentId : turn.userMessageId;
  let placed: Placed | undefined;
  try {
    placed = await db.transaction(async (tx) => {
      const tail = busyTail(await listActiveRuns(tx, conversationId), anchor);
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
          parts: turn.parts,
          role: "user",
        });
        if (!inserted.ok) {
          return tx.rollback();
        }
        userMessageId = inserted.value.id;
      }
      const created = await insertRun(tx, {
        afterRunId: tail?.id ?? null,
        context: resolved.context,
        conversationId,
        createdBy: actor.userId,
        idempotencyKey: input.idempotencyKey ?? null,
        options: runOptionsSchema.parse(input.options ?? {}),
        status: "queued",
        target: resolved.target,
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

/** Whether `actor` may answer with `target`: any model, or an agent they may `use`. */
export const mayRun = async (
  db: Db,
  actor: Pick<Actor, "userId">,
  target: RunTarget
): Promise<boolean> =>
  target.type === "model" ||
  (await canUseLibraryItem(db, actor.userId, "agent", target.id));

export const createRun = async (
  deps: CreateRunDeps,
  actor: Actor,
  input: CreateRunInput
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
  const target = targetFor(input, conversation, deps.defaultModel);
  if (!target) {
    return err({ type: "no_model" });
  }
  // Knowing an agent's id isn't leave to run it (D13), and a chat's default
  // agent is its owner's choice, not a share of the agent. `NOT_FOUND`, like
  // the library, so ids don't leak.
  if (!(await mayRun(db, actor, target))) {
    return err({ type: "not_found" });
  }
  const context = await settleContext(deps, actor, input, conversation);
  if (!context.ok) {
    return context;
  }
  const budget = await deps.budget(actor, context.value);
  if (!budget.ok) {
    return err({ data: budget.error, type: "budget_exceeded" });
  }

  const regenerating = await checkRegenerate(db, conversation.id, input);
  if (!regenerating.ok) {
    return regenerating;
  }
  const placed = await placeRun(db, actor, input, {
    context: context.value,
    target,
  });
  if (!placed) {
    return err({
      message: "The message to answer isn't in this conversation.",
      path: ["input", "parentId"],
      type: "invalid",
    });
  }

  let { run } = placed;
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

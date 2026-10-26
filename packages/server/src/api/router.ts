import { implement, ORPCError } from "@orpc/server";
import type { RunExecutor } from "@workspace/ai/ports/run-executor";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { ModelSelector } from "@workspace/contract/schemas/models";
import { isTerminalRunStatus } from "@workspace/contract/schemas/runs";
import type { Db } from "@workspace/db/client";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getConversationWithBranch,
  listConversations,
  listParticipants,
  setConversationContext,
  setParticipantState,
  updateConversation,
} from "@workspace/db/queries/conversations";
import {
  pauseSchedulesFor,
  scheduleSummaries,
} from "@workspace/db/queries/dots";
import {
  deleteMessage,
  getBranchPath,
  getMessage,
  getMessageTree,
  insertMessage,
  listMessages,
  toMessage,
} from "@workspace/db/queries/messages";
import {
  getRun,
  listActiveRuns,
  listRuns,
  type RunRow,
} from "@workspace/db/queries/runs";
import { markSteer, removeUnrunTurn } from "@workspace/db/queries/steers";

import {
  type AccessLevel,
  type Actor,
  actorFor,
  type ConversationAccess,
  type RequestContext,
} from "../context";
import { DOT_RUN_KEY_PREFIX, isDotRunKey } from "../dots/policy";
import { toConversationSchedule } from "../dots/schedule-policy";
import type { StreamChannel } from "../ports/stream-channel";
import { type BudgetCheck, storeContext } from "../runs/chat-context";
import { newChatMode } from "../runs/chat-mode";
import {
  type CreateRunError,
  createRun,
  mayRun,
  partsMaySteer,
} from "../runs/create-run";
import { pinnedDraft } from "../runs/drafts";
import type { MemorySettings } from "../runs/memory";
import { queuePosition, toRun } from "../runs/state";
import {
  type ConversationEvents,
  createTypingGate,
  userSummaryOf,
} from "../stream/conversation-events";
import { createFeedbackRouter } from "./feedback";
import {
  toConversation,
  toMessages,
  toParticipant,
  toParticipantState,
} from "./mappers";
import { createMemoryRouter } from "./memory";

// The `conversations`, `messages` and `runs` procedure groups (D26), over
// `@workspace/db`. Handlers are the imperative shell: they check access,
// call queries and services that return `Result`s, and turn errors into the
// contract's typed errors. Other groups arrive as extra routers (see `app`).

export interface ApiServices {
  readonly access: ConversationAccess;
  readonly budget: BudgetCheck;
  /** `features.chatModes`: runs take the chat's Chat / Code mode. */
  readonly chatModes: boolean;
  readonly db: Db;
  /** `models.default`: the target when neither the run nor the chat names one. */
  readonly defaultModel: ModelSelector | null;
  /** Each conversation's live channel (D25). */
  readonly events: ConversationEvents;
  readonly executor: RunExecutor;
  /** The memory feature's switch and size cap (022). */
  readonly memory: MemorySettings;
  readonly streams: StreamChannel;
}

interface Issue {
  readonly message: string;
  readonly path: (string | number)[];
}

/**
 * The contract's `VALIDATION` (422). Built by hand where a helper has no
 * procedure's `errors` at hand; the status and message come from the
 * contract's error map so the wire is the same.
 */
const validationError = (options: {
  readonly data: { readonly issues: Issue[] };
}) =>
  new ORPCError("VALIDATION", {
    data: options.data,
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });

const invalidCursor = () =>
  validationError({
    data: { issues: [{ message: "Unknown cursor.", path: ["cursor"] }] },
  });

export const createChatRouter = (services: ApiServices) => {
  const { access, db, events, executor } = services;
  const typingAllowed = createTypingGate();
  const os = implement(contract).$context<RequestContext>();

  const authed = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context: { actor: await actorFor(db, context.session) } });
  });

  /**
   * Throws unless `actor` may act at `level`. A conversation the caller
   * can't read is `NOT_FOUND`, so ids don't leak; one they can read but not
   * change is `FORBIDDEN`.
   */
  const requireAccess = async (
    actor: Actor,
    conversationId: ConversationId,
    level: AccessLevel
  ) => {
    if (await access(actor, conversationId, level)) {
      return;
    }
    if (level === "write" && (await access(actor, conversationId, "read"))) {
      throw new ORPCError("FORBIDDEN");
    }
    throw new ORPCError("NOT_FOUND");
  };

  /** The caller's schedule on each conversation, for "Next run …" (173). */
  const withSchedules = async (
    actor: Actor,
    items: readonly Conversation[]
  ): Promise<Conversation[]> => {
    const summaries = await scheduleSummaries(
      db,
      actor.userId,
      items.map((each) => each.id)
    );
    return items.map((each) => {
      const row = summaries.get(each.id);
      return {
        ...each,
        schedule: row ? toConversationSchedule(row) : null,
      };
    });
  };

  const viewOf = async (actor: Actor, id: ConversationId) => {
    const found = await getConversation(db, id, actor);
    if (!found.ok) {
      throw new ORPCError("NOT_FOUND");
    }
    const [view] = await withSchedules(actor, [
      toConversation(found.value, actor.userId),
    ]);
    if (!view) {
      throw new ORPCError("NOT_FOUND");
    }
    return view;
  };

  const runOf = async (row: RunRow) =>
    toRun(
      row,
      row.status === "queued"
        ? queuePosition(row, await listActiveRuns(db, row.conversationId))
        : 1
    );

  const readableRun = async (
    actor: Actor,
    id: RunRow["id"],
    level: AccessLevel
  ) => {
    const found = await getRun(db, id);
    if (!found.ok) {
      throw new ORPCError("NOT_FOUND");
    }
    await requireAccess(actor, found.value.conversationId, level);
    return found.value;
  };

  /** Why a turn isn't queued any more, as the conflict to answer with. */
  const notQueued = (
    row: RunRow,
    errors: {
      CONFLICT: (options: {
        data: { reason: "run_active" | "run_finished" };
      }) => Error;
    }
  ): Error =>
    errors.CONFLICT({
      data: {
        reason: isTerminalRunStatus(row.status) ? "run_finished" : "run_active",
      },
    });

  /** A queued turn someone who may send in its chat asks about. */
  const queuedRun = async (
    actor: Actor,
    id: RunRow["id"],
    errors: Parameters<typeof notQueued>[1]
  ): Promise<RunRow> => {
    const row = await readableRun(actor, id, "write");
    if (row.status !== "queued") {
      throw notQueued(row, errors);
    }
    return row;
  };

  const conversations = {
    create: authed.conversations.create.handler(async ({ context, input }) => {
      const stored = await storeContext(db, context.actor, input.context);
      if (!stored.ok) {
        throw validationError({
          data: {
            issues: [
              {
                message:
                  stored.error.type === "no_personal_space"
                    ? "You have no personal space yet."
                    : "You aren't a member of that context.",
                path: ["context"],
              },
            ],
          },
        });
      }
      // A chat that answers with an agent's draft by default is the
      // builder's test chat (033): the contract has no field for it, and
      // needs none, since nothing else pins a draft. It stays out of the
      // history and search, and the cleanup job deletes it later.
      const draft = await pinnedDraft(db, input.defaultTarget);
      const row = await createConversation(db, {
        context: stored.value,
        defaultTarget: input.defaultTarget ?? null,
        mode: newChatMode(services.chatModes, input.mode),
        ownerId: context.actor.userId,
        purpose: draft ? "test" : "chat",
        title: input.title ?? null,
      });
      return viewOf(context.actor, row.id);
    }),

    delete: authed.conversations.delete.handler(async ({ context, input }) => {
      const found = await getConversation(db, input.id, context.actor);
      if (!found.ok) {
        throw new ORPCError("NOT_FOUND");
      }
      // Sharing lets people edit a chat, not delete it for everyone.
      if (found.value.myPermission !== "owner") {
        throw new ORPCError("FORBIDDEN");
      }
      await deleteConversation(db, input.id);
    }),

    fork: authed.conversations.fork.handler(async ({ context, input }) => {
      const { actor } = context;
      await requireAccess(actor, input.id, "read");
      const source = await getConversation(db, input.id, actor);
      const branch = await getBranchPath(db, input.id, input.leafId);
      if (!(source.ok && branch.ok)) {
        throw new ORPCError("NOT_FOUND");
      }
      const stored = await storeContext(
        db,
        actor,
        input.context ?? { type: "personal" }
      );
      if (!stored.ok) {
        throw validationError({
          data: {
            issues: [
              {
                message: "You can't fork into that context.",
                path: ["context"],
              },
            ],
          },
        });
      }
      const forked = await db.transaction(async (tx) => {
        const row = await createConversation(tx, {
          context: stored.value,
          defaultTarget: source.value.defaultTarget,
          mode: newChatMode(services.chatModes, source.value.mode),
          ownerId: actor.userId,
          title: input.title ?? source.value.title,
        });
        let parentId: MessageId | null = null;
        for (const message of branch.value.messages) {
          // biome-ignore lint/performance/noAwaitInLoops: each copy is the next one's parent.
          const copied = await insertMessage(tx, {
            agent:
              message.agentId && message.agentVersionId
                ? { id: message.agentId, versionId: message.agentVersionId }
                : null,
            authorId: message.authorId,
            conversationId: row.id,
            mode: message.mode,
            model: message.model,
            parentId,
            parts: message.parts,
            role: message.role,
            status: message.status,
            usage: message.usage,
          });
          if (!copied.ok) {
            return tx.rollback();
          }
          parentId = copied.value.id;
        }
        return row;
      });
      return viewOf(actor, forked.id);
    }),

    get: authed.conversations.get.handler(({ context, input }) =>
      viewOf(context.actor, input.id)
    ),

    list: authed.conversations.list.handler(async ({ context, input }) => {
      const page = await listConversations(db, context.actor, input);
      if (!page.ok) {
        throw invalidCursor();
      }
      return {
        items: await withSchedules(
          context.actor,
          page.value.items.map((view) =>
            toConversation(view, context.actor.userId)
          )
        ),
        nextCursor: page.value.nextCursor,
      };
    }),

    participants: authed.conversations.participants.handler(
      async ({ context, input }) => {
        await requireAccess(context.actor, input.id, "read");
        return (await listParticipants(db, input.id)).map(toParticipant);
      }
    ),

    setContext: authed.conversations.setContext.handler(
      async ({ context, errors, input }) => {
        await requireAccess(context.actor, input.id, "write");
        const stored = await storeContext(db, context.actor, input.context);
        if (!stored.ok) {
          throw validationError({
            data: {
              issues: [
                {
                  message: "You aren't a member of that context.",
                  path: ["context"],
                },
              ],
            },
          });
        }
        const set = await setConversationContext(db, input.id, stored.value);
        if (!set.ok) {
          throw set.error.type === "conflict"
            ? errors.CONFLICT({ data: { reason: "context_locked" } })
            : new ORPCError("NOT_FOUND");
        }
        return viewOf(context.actor, input.id);
      }
    ),

    typing: authed.conversations.typing.handler(async ({ context, input }) => {
      // Checked before anything else, so repeats cost no queries.
      if (!typingAllowed(context.actor.userId, input.id)) {
        return;
      }
      await requireAccess(context.actor, input.id, "write");
      const user = await userSummaryOf(db, context.actor.userId);
      if (user) {
        await events.publish(input.id, { type: "typing", user });
      }
    }),

    update: authed.conversations.update.handler(async ({ context, input }) => {
      const { actor } = context;
      const { archived, defaultTarget, id, mode, pinned, title } = input;
      if (
        archived !== undefined ||
        defaultTarget !== undefined ||
        mode !== undefined ||
        title !== undefined
      ) {
        await requireAccess(actor, id, "write");
        await updateConversation(db, id, {
          archived,
          defaultTarget,
          mode,
          title,
        });
        if (archived) {
          // Archiving a chat pauses the schedules posting into it (173).
          await pauseSchedulesFor(db, id);
        }
      } else {
        await requireAccess(actor, id, "read");
      }
      if (pinned !== undefined) {
        // Pinning is per user (D25), so readers may pin too.
        await setParticipantState(db, id, actor.userId, { pinned });
      }
      return viewOf(actor, id);
    }),

    updateMyState: authed.conversations.updateMyState.handler(
      async ({ context, input }) => {
        await requireAccess(context.actor, input.conversationId, "read");
        const row = await setParticipantState(
          db,
          input.conversationId,
          context.actor.userId,
          {
            activeLeafId: input.activeLeafId,
            followingUserId: input.followingUserId,
            lastReadAt:
              input.lastReadAt === undefined
                ? undefined
                : new Date(input.lastReadAt),
          }
        );
        return toParticipantState(row);
      }
    ),
  };

  const messages = {
    delete: authed.messages.delete.handler(
      async ({ context, errors, input }) => {
        const found = await getMessage(db, input.id);
        if (!found.ok) {
          throw new ORPCError("NOT_FOUND");
        }
        const { conversationId } = found.value;
        await requireAccess(context.actor, conversationId, "write");
        const nodes = await getMessageTree(db, conversationId);
        const doomed = new Set<string>([input.id]);
        // Nodes come oldest first, so a parent is always seen before its children.
        for (const node of nodes) {
          if (node.parentId && doomed.has(node.parentId)) {
            doomed.add(node.id);
          }
        }
        const busy = (await listActiveRuns(db, conversationId)).some(
          (run) =>
            doomed.has(run.userMessageId) ||
            (run.assistantMessageId !== null &&
              doomed.has(run.assistantMessageId))
        );
        if (busy) {
          throw errors.CONFLICT({ data: { reason: "run_active" } });
        }
        await deleteMessage(db, input.id);
      }
    ),

    get: authed.messages.get.handler(async ({ context, input }) => {
      const found = await getMessage(db, input.id);
      if (!found.ok) {
        throw new ORPCError("NOT_FOUND");
      }
      await requireAccess(context.actor, found.value.conversationId, "read");
      const message = toMessage(found.value);
      if (!message.ok) {
        throw new ORPCError("NOT_FOUND");
      }
      return message.value;
    }),

    list: authed.messages.list.handler(async ({ context, input }) => {
      await requireAccess(context.actor, input.conversationId, "read");
      const page = await listMessages(db, input.conversationId, input);
      if (!page.ok) {
        throw invalidCursor();
      }
      return {
        items: toMessages(page.value.items),
        nextCursor: page.value.nextCursor,
      };
    }),

    path: authed.messages.path.handler(async ({ context, input }) => {
      const found = await getConversationWithBranch(
        db,
        input.conversationId,
        context.actor,
        input.leafId
      );
      if (!found.ok) {
        throw new ORPCError("NOT_FOUND");
      }
      const { branch } = found.value;
      return {
        conversationId: input.conversationId,
        leafId: branch.leafId,
        messages: toMessages(branch.messages),
        siblings: [...branch.siblings],
      };
    }),

    tree: authed.messages.tree.handler(async ({ context, input }) => {
      await requireAccess(context.actor, input.conversationId, "read");
      return {
        conversationId: input.conversationId,
        nodes: await getMessageTree(db, input.conversationId),
      };
    }),
  };

  const failRun = (
    error: CreateRunError,
    errors: {
      ALLOWANCE_SPENT: (options: {
        data: Extract<CreateRunError, { type: "allowance_spent" }>["data"];
      }) => Error;
      BUDGET_EXCEEDED: (options: {
        data: Extract<CreateRunError, { type: "budget_exceeded" }>["data"];
      }) => Error;
      CONFLICT: (options: { data: { reason: "context_locked" } }) => Error;
      PROVIDER_UNAVAILABLE: (options: { data: { provider: null } }) => Error;
    }
  ): Error => {
    switch (error.type) {
      case "not_found":
        return new ORPCError("NOT_FOUND");
      case "forbidden":
        return new ORPCError("FORBIDDEN");
      case "context_locked":
        return errors.CONFLICT({ data: { reason: "context_locked" } });
      case "invalid":
        return validationError({
          data: { issues: [{ message: error.message, path: error.path }] },
        });
      case "budget_exceeded":
        return errors.BUDGET_EXCEEDED({ data: error.data });
      case "allowance_spent":
        return errors.ALLOWANCE_SPENT({ data: error.data });
      case "no_model":
        return errors.PROVIDER_UNAVAILABLE({ data: { provider: null } });
      default:
        return error satisfies never;
    }
  };

  const runs = {
    cancel: authed.runs.cancel.handler(async ({ context, errors, input }) => {
      await readableRun(context.actor, input.id, "write");
      const cancelled = await executor.cancel(input.id, context.actor.userId);
      if (!cancelled.ok) {
        throw cancelled.error.type === "invalid_state"
          ? errors.CONFLICT({ data: { reason: "run_finished" } })
          : new ORPCError("NOT_FOUND");
      }
      return runOf(await readableRun(context.actor, input.id, "read"));
    }),

    create: authed.runs.create.handler(async ({ context, errors, input }) => {
      if (isDotRunKey(input.idempotencyKey)) {
        throw validationError({
          data: {
            issues: [
              {
                message: `Keys starting with "${DOT_RUN_KEY_PREFIX}" are reserved.`,
                path: ["idempotencyKey"],
              },
            ],
          },
        });
      }
      const created = await createRun(
        {
          budget: services.budget,
          chatModes: services.chatModes,
          db,
          defaultModel: services.defaultModel,
          executor,
        },
        context.actor,
        input
      );
      if (!created.ok) {
        throw failRun(created.error, errors);
      }
      return created.value;
    }),

    get: authed.runs.get.handler(async ({ context, input }) =>
      runOf(await readableRun(context.actor, input.id, "read"))
    ),

    list: authed.runs.list.handler(async ({ context, input }) => {
      await requireAccess(context.actor, input.conversationId, "read");
      const page = await listRuns(db, input.conversationId, input);
      if (!page.ok) {
        throw invalidCursor();
      }
      const active = await listActiveRuns(db, input.conversationId);
      return {
        items: page.value.items.map((row) =>
          toRun(row, row.status === "queued" ? queuePosition(row, active) : 1)
        ),
        nextCursor: page.value.nextCursor,
      };
    }),

    steer: authed.runs.steer.handler(async ({ context, errors, input }) => {
      const queued = await queuedRun(context.actor, input.id, errors);
      const asked = await getMessage(db, queued.userMessageId);
      if (!(asked.ok && partsMaySteer(asked.value.parts))) {
        throw validationError({
          data: {
            issues: [
              {
                message:
                  "A message that picks skills or an agent, or approves a plan, runs as its own turn.",
                path: ["id"],
              },
            ],
          },
        });
      }
      const marked = await markSteer(db, input.id);
      if (!marked) {
        throw notQueued(
          await readableRun(context.actor, input.id, "read"),
          errors
        );
      }
      return runOf(marked);
    }),

    submitApprovals: authed.runs.submitApprovals.handler(
      async ({ context, errors, input }) => {
        const run = await readableRun(context.actor, input.runId, "write");
        // Approving lets the agent go on acting, so it takes what starting
        // it took: someone who can't use the agent (or no longer can) can't
        // push its tool calls through, and a draft run takes `edit` (033).
        if (
          !(await mayRun(db, context.actor, run.target, {
            draft: run.agentDraft,
          }))
        ) {
          throw new ORPCError("FORBIDDEN");
        }
        const submitted = await executor.submitApprovals(
          input.runId,
          input.decisions,
          context.actor.userId
        );
        if (!submitted.ok) {
          switch (submitted.error.type) {
            case "invalid_state":
              throw errors.CONFLICT({
                data: { reason: "not_awaiting_approval" },
              });
            case "unknown_tool_call":
              throw validationError({
                data: {
                  issues: [
                    {
                      message: "That tool call isn't waiting on a decision.",
                      path: ["decisions"],
                    },
                  ],
                },
              });
            default:
              throw new ORPCError("NOT_FOUND");
          }
        }
        return runOf(await readableRun(context.actor, input.runId, "read"));
      }
    ),

    withdraw: authed.runs.withdraw.handler(
      async ({ context, errors, input }) => {
        await queuedRun(context.actor, input.id, errors);
        const cancelled = await executor.cancel(input.id, context.actor.userId);
        if (!cancelled.ok) {
          throw cancelled.error.type === "invalid_state"
            ? errors.CONFLICT({ data: { reason: "run_finished" } })
            : new ORPCError("NOT_FOUND");
        }
        const run = await runOf(
          await readableRun(context.actor, input.id, "read")
        );
        // A turn that started before the cancel landed keeps its answer.
        const messageRemoved =
          run.state.status === "cancelled" &&
          (await removeUnrunTurn(db, input.id));
        return { messageRemoved, run };
      }
    ),
  };

  return {
    conversations,
    messages,
    runs,
    ...createFeedbackRouter(db, access),
    ...createMemoryRouter(db, services.memory),
  };
};

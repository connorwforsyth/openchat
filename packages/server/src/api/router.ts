import { implement, ORPCError } from "@orpc/server";
import type { RunExecutor } from "@workspace/ai/ports/run-executor";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { ModelSelector } from "@workspace/contract/schemas/models";
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

import {
  type AccessLevel,
  type Actor,
  actorFor,
  type ConversationAccess,
  type RequestContext,
} from "../context";
import type { StreamChannel } from "../ports/stream-channel";
import { type BudgetCheck, storeContext } from "../runs/chat-context";
import { type CreateRunError, createRun, mayRun } from "../runs/create-run";
import { pinnedDraft } from "../runs/drafts";
import type { MemorySettings } from "../runs/memory";
import { queuePosition, toRun } from "../runs/state";
import type { RunTimings } from "../runs/timing";
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
  readonly db: Db;
  /** `models.default`: the target when neither the run nor the chat names one. */
  readonly defaultModel: ModelSelector | null;
  readonly executor: RunExecutor;
  /** The memory feature's switch and size cap (022). */
  readonly memory: MemorySettings;
  readonly streams: StreamChannel;
  /** Server timing marks on the way to a run's first token (ticket 102). */
  readonly timings?: RunTimings;
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
  const { access, db, executor } = services;
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

  const viewOf = async (actor: Actor, id: ConversationId) => {
    const found = await getConversation(db, id, actor);
    if (!found.ok) {
      throw new ORPCError("NOT_FOUND");
    }
    return toConversation(found.value, actor.userId);
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
        items: page.value.items.map((view) =>
          toConversation(view, context.actor.userId)
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

    update: authed.conversations.update.handler(async ({ context, input }) => {
      const { actor } = context;
      const { archived, defaultTarget, id, pinned, title } = input;
      if (
        archived !== undefined ||
        defaultTarget !== undefined ||
        title !== undefined
      ) {
        await requireAccess(actor, id, "write");
        await updateConversation(db, id, { archived, defaultTarget, title });
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
      const created = await createRun(
        {
          budget: services.budget,
          db,
          defaultModel: services.defaultModel,
          executor,
          timings: services.timings,
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
  };

  return {
    conversations,
    messages,
    runs,
    ...createFeedbackRouter(db, access),
    ...createMemoryRouter(db, services.memory),
  };
};

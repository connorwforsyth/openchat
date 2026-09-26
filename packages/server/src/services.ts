import type { KeyStore } from "@workspace/ai/keys/key-store";
import {
  createMemoryKeyStore,
  instanceKeysFromConfig,
} from "@workspace/ai/keys/key-store.memory";
import type { ProviderRegistry } from "@workspace/ai/ports/provider-registry";
import type { AppConfig } from "@workspace/config/schema";
import type { Db } from "@workspace/db/client";
import { getConversation } from "@workspace/db/queries/conversations";

import type { ApiServices } from "./api/router";
import { actorFor, type ConversationAccess, grantAccess } from "./context";
import { coreJobHandlers } from "./jobs/handlers";
import {
  enqueueJob,
  type JobHandlers,
  type Jobs,
  registerJobs,
} from "./jobs/registry";
import type { JobQueue } from "./ports/job-queue";
import {
  type BudgetCheck,
  budgetCheck,
  recordRunUsage,
} from "./runs/chat-context";
import {
  createInProcessExecutor,
  type InProcessExecutor,
  type RunSettled,
} from "./runs/executor";
import {
  createModelLoader,
  createTurnResolver,
  type ModelLoader,
  type TurnResolver,
  type TurnResolverDeps,
} from "./runs/turn";
import type { Listen } from "./stream/listen";
import {
  createPostgresStreamChannel,
  type PostgresStreamChannel,
} from "./stream/postgres-stream-channel";

// Wires the run machinery together over one database: the stream channel,
// the executor, the turn resolver and the jobs they enqueue. Everything is a
// parameter, so tests swap the model (`resolveTurn`) and the queue.

export interface ServicesOptions {
  /** Grant check; 025 passes 012's `checkAccess`. Defaults to the grant-aware one in `context`. */
  readonly access?: ConversationAccess;
  readonly budget?: BudgetCheck;
  readonly config: AppConfig;
  readonly db: Db;
  /** Background jobs; `null` runs without titles or pruning. */
  readonly jobs: JobQueue<Jobs> | null;
  /** Keys from the database (012/013); defaults to instance keys from app.config.yaml. */
  readonly keyStore?: KeyStore;
  /** LISTEN for stream fan-out; without it subscribers poll. */
  readonly listen?: Listen;
  readonly now?: () => Date;
  readonly registry: ProviderRegistry;
  readonly report?: (message: string, cause: unknown) => void;
  /** Overrides model resolution entirely (tests hand in mock models). */
  readonly resolveTurn?: TurnResolver;
  readonly tools?: Pick<TurnResolverDeps, "builtins" | "mcp" | "routeAuto">;
}

export interface Services extends ApiServices {
  readonly executor: InProcessExecutor;
  /** Handlers for the jobs this package owns; pass them to `registerJobs`. */
  readonly jobHandlers: JobHandlers;
  readonly loadModel: ModelLoader;
  /** Aborts running runs and stops listening. */
  readonly stop: () => Promise<void>;
  readonly streams: PostgresStreamChannel;
}

export const createServices = (options: ServicesOptions): Services => {
  const { config, db, jobs } = options;
  const report = options.report ?? (() => undefined);
  const keyStore =
    options.keyStore ?? createMemoryKeyStore(instanceKeysFromConfig(config));
  const turnDeps = {
    ...options.tools,
    config,
    db,
    keyStore,
    registry: options.registry,
  };
  const loadModel = createModelLoader(turnDeps);
  const streams = createPostgresStreamChannel({ db, listen: options.listen });

  const afterRun = async (event: RunSettled) => {
    await recordRunUsage(db, event).catch((cause: unknown) =>
      report("couldn't record usage", cause)
    );
    if (!jobs) {
      return;
    }
    await enqueueJob(jobs, "run.prune", { runId: event.run.id });
    if (event.status !== "succeeded") {
      return;
    }
    const actor = await actorFor(db, { userId: event.run.createdBy });
    const conversation = await getConversation(
      db,
      event.run.conversationId,
      actor
    );
    if (conversation.ok && conversation.value.title === null) {
      await enqueueJob(
        jobs,
        "title.generate",
        { conversationId: event.run.conversationId, userId: actor.userId },
        { singletonKey: `title:${event.run.conversationId}` }
      );
    }
  };

  const executor = createInProcessExecutor({
    db,
    now: options.now,
    onSettled: afterRun,
    report,
    resolveTurn: options.resolveTurn ?? createTurnResolver(turnDeps),
    timeoutMs: config.limits.runTimeoutSeconds * 1000,
    writer: streams,
  });

  const titleSelector = config.models.auto.cheap ?? config.models.default;
  const jobHandlers = coreJobHandlers({
    db,
    streams,
    titleModel: async ({ context, signal, userId }) => {
      if (!titleSelector) {
        return null;
      }
      const loaded = await loadModel({ context, userId }, titleSelector, {
        signal,
        state: { facts: {}, history: [], input: "" },
      });
      return loaded.ok ? loaded.value.model : null;
    },
  });

  return {
    access: options.access ?? grantAccess(db),
    budget: options.budget ?? budgetCheck(db, options.now),
    db,
    defaultModel: config.models.default,
    executor,
    jobHandlers,
    loadModel,
    stop: async () => {
      await executor.shutdown();
      await streams.stop();
    },
    streams,
  };
};

/** Registers this package's job handlers plus any the caller adds (021, 022). */
export const registerCoreJobs = (
  jobs: JobQueue<Jobs>,
  services: Pick<Services, "jobHandlers">,
  extra: JobHandlers = {}
) => registerJobs(jobs, { ...services.jobHandlers, ...extra });

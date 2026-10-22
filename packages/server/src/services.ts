import type { KeyStore } from "@workspace/ai/keys/key-store";
import {
  createMemoryKeyStore,
  instanceKeysFromConfig,
} from "@workspace/ai/keys/key-store.memory";
import type { ProviderRegistry } from "@workspace/ai/ports/provider-registry";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import { createArtifactTools } from "@workspace/ai/tools/artifacts";
import {
  type ArtifactDesignNotes,
  instanceArtifactKinds,
} from "@workspace/artifacts-kit/instance";
import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import type { AppConfig } from "@workspace/config/schema";
import type { ModelSelector } from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import {
  attachedArtifactsSection,
  dbArtifactStore,
} from "./api/artifacts-context";
import type { ApiServices } from "./api/router";
import { compileTsx } from "./artifacts/compile-tsx";
import { type ConversationAccess, grantAccess } from "./context";
import {
  type DotComputers,
  dbDotConversation,
  withDotComputer,
} from "./dots/computer";
import { dotJobHandlers } from "./dots/jobs";
import { settleScheduleRun } from "./dots/schedules";
import type { DotDeps, EnsureDotWorkspace } from "./dots/service";
import { dbDotPolicy, withDotPolicy } from "./dots/turn";
import { createEvalJobHandlers } from "./evals/run";
import { coreJobHandlers, shouldTitle } from "./jobs/handlers";
import {
  enqueueJob,
  type JobHandlers,
  type Jobs,
  registerJobs,
} from "./jobs/registry";
import { testChatJobHandlers } from "./jobs/test-chats";
import { skillAuthoringTools } from "./library/skill-authoring";
import type { JobQueue } from "./ports/job-queue";
import type { Storage } from "./ports/storage";
import { attachmentsFor, uploadReader } from "./runs/attachments";
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
import { type MemorySettings, withChatMemory } from "./runs/memory";
import { skillFileReader } from "./runs/skills";
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
  /** The instance's DESIGN.md prose per kind, added to that kind's guide. */
  readonly artifactDesign?: ArtifactDesignNotes;
  readonly budget?: BudgetCheck;
  /** A Dot's own computer (172); without it Dots have none. */
  readonly computers?: DotComputers;
  readonly config: AppConfig;
  readonly db: Db;
  /** Creates a Dot's workspace on its provider before its first run (172). */
  readonly ensureDotWorkspace?: EnsureDotWorkspace;
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
  /** Uploads, for attachments a model reads as file parts (044). */
  readonly storage?: Storage;
  /**
   * What `file.storage_driver` records for `storage`; with it, a skill the
   * model writes (128) can bundle text files.
   */
  readonly storageDriver?: "local" | "s3";
  readonly tools?: Pick<
    TurnResolverDeps,
    | "builtins"
    | "catalog"
    | "decider"
    | "images"
    | "knowledge"
    | "mcp"
    | "mcpFor"
    | "mcpSelectionFor"
    | "orgPolicy"
    | "routeAuto"
    | "sandbox"
    | "skillFiles"
    | "webSearch"
  >;
}

/**
 * The model a schedule on an ordinary chat answers with (175): the
 * configured one, else the `fast` alias, else the instance default. Cheap
 * by default, since nobody's watching what it spends.
 */
export const scheduleModel = (config: AppConfig): ModelSelector | null =>
  config.schedules.defaultModel ??
  (config.models.aliases.fast ? "fast" : null) ??
  config.models.auto.cheap ??
  config.models.default;

export interface Services extends ApiServices {
  /** The artifact kinds this instance offers, with its settings applied (125). */
  readonly artifactKinds: ArtifactKindRegistry;
  /** What the Dots API and jobs run on (172). */
  readonly dots: DotDeps;
  readonly executor: InProcessExecutor;
  /** Handlers for the jobs this package owns; pass them to `registerJobs`. */
  readonly jobHandlers: JobHandlers;
  readonly loadModel: ModelLoader;
  /** Aborts running runs and stops listening. */
  readonly stop: () => Promise<void>;
  readonly streams: PostgresStreamChannel;
}

// The run's artifact store moved beside the artifacts API (124); kept
// exported from here for the callers that import it.
// biome-ignore lint/performance/noBarrelFile: one name, kept where callers expect it.
export { dbArtifactStore } from "./api/artifacts-context";

export const createServices = (options: ServicesOptions): Services => {
  const { config, db, jobs } = options;
  const report = options.report ?? (() => undefined);
  const keyStore =
    options.keyStore ?? createMemoryKeyStore(instanceKeysFromConfig(config));
  // The instance layer of the kinds' rules (125): its site settings.
  const artifactKinds = instanceArtifactKinds(config.artifacts.kinds, {
    compileTsx,
    design: options.artifactDesign,
  });
  const turnDeps = {
    artifactKinds,
    artifacts: (run: RunStart) =>
      createArtifactTools(dbArtifactStore(db, run), artifactKinds),
    attachedArtifacts: (run: RunStart) => attachedArtifactsSection(db, run),
    // The library's own rules, as the run's creator (128).
    skillAuthoring: skillAuthoringTools({
      db,
      now: options.now,
      ...(options.storage && options.storageDriver
        ? {
            uploads: {
              driver: options.storageDriver,
              storage: options.storage,
            },
          }
        : {}),
    }),
    ...(options.storage
      ? { skillFiles: skillFileReader(db, options.storage) }
      : {}),
    ...options.tools,
    config,
    db,
    keyStore,
    registry: options.registry,
  };
  const loadModel = createModelLoader(turnDeps);
  const streams = createPostgresStreamChannel({ db, listen: options.listen });

  const access = options.access ?? grantAccess(db);
  const afterRun = async (event: RunSettled) => {
    await recordRunUsage(db, config.models.prices, event).catch(
      (cause: unknown) => report("couldn't record usage", cause)
    );
    await settleScheduleRun(db, event.run.id, event.status).catch(
      (cause: unknown) => report("couldn't record a scheduled run", cause)
    );
    if (!jobs) {
      return;
    }
    await enqueueJob(jobs, "run.prune", { runId: event.run.id });
    if (event.status !== "succeeded") {
      return;
    }
    const { conversationId, createdBy } = event.run;
    if (await shouldTitle(db, conversationId, createdBy)) {
      await enqueueJob(
        jobs,
        "title.generate",
        { conversationId, userId: createdBy },
        { singletonKey: `title:${conversationId}` }
      );
    }
  };

  const memory: MemorySettings = {
    enabled: config.features.memory,
    maxChars: config.limits.memoryMaxChars,
  };

  const readUpload = options.storage
    ? uploadReader(db, options.storage)
    : undefined;
  const executor = createInProcessExecutor({
    attachments: (model) => attachmentsFor(config.providers, model, readUpload),
    db,
    maxSteps: config.limits.agentMaxSteps,
    now: options.now,
    onSettled: afterRun,
    report,
    // Memory wraps whichever resolver runs, so scripted test turns get it
    // too; a Dot's unattended policy (172) goes on last, over every tool.
    // A Dot's computer joins before the unattended policy sees the tools.
    resolveTurn: withDotPolicy(
      withDotComputer(
        withChatMemory(options.resolveTurn ?? createTurnResolver(turnDeps), {
          db,
          report,
          settings: memory,
        }),
        options.computers,
        dbDotConversation(db)
      ),
      dbDotPolicy({
        access,
        db,
        limits: config.schedules,
        now: options.now,
      })
    ),
    timeoutMs: config.limits.runTimeoutSeconds * 1000,
    writer: streams,
  });

  const conversationTitleModel =
    config.models.conversationTitleModel === false
      ? null
      : (config.models.conversationTitleModel ??
        config.models.auto.cheap ??
        config.models.default);
  const jobHandlers = coreJobHandlers({
    db,
    streams,
    titleModel: async ({ context, signal, userId }) => {
      if (!conversationTitleModel) {
        return null;
      }
      const loaded = await loadModel(
        { context, userId },
        conversationTitleModel,
        {
          signal,
          state: { facts: {}, history: [], input: "" },
        }
      );
      return loaded.ok ? loaded.value.model : null;
    },
  });

  const budget = options.budget ?? budgetCheck(db, options.now);
  const dots: DotDeps = {
    access,
    db,
    defaultModel: scheduleModel(config),
    ensureWorkspace: options.ensureDotWorkspace,
    limits: config.schedules,
    now: options.now ?? (() => new Date()),
    runs: { budget, db, defaultModel: config.models.default, executor },
  };

  return {
    access,
    artifactKinds,
    budget,
    db,
    defaultModel: config.models.default,
    dots,
    executor,
    jobHandlers: {
      ...jobHandlers,
      ...testChatJobHandlers({ db, now: options.now }),
      ...dotJobHandlers({ ...dots, queue: jobs }),
      ...createEvalJobHandlers({
        db,
        loadModel,
        now: options.now,
        prices: config.models.prices,
        report,
      }),
    },
    loadModel,
    memory,
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

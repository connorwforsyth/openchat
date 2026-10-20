import { createHmac } from "node:crypto";

import type { AnyRouter } from "@orpc/server";
import { createDecider } from "@workspace/ai/decider/from-config";
import { instanceKeysFromConfig } from "@workspace/ai/keys/key-store.memory";
import type { ChatKeys } from "@workspace/ai/keys/resolve";
import type { Decider } from "@workspace/ai/ports/decider";
import type { Embedder } from "@workspace/ai/ports/embedder";
import type { ProviderRegistry } from "@workspace/ai/ports/provider-registry";
import {
  buildRegistry,
  type DiscoveringRegistry,
} from "@workspace/ai/providers/registry";
import { createEmbedder } from "@workspace/ai/rag/embedder";
import { REINDEX_EMBEDDINGS_JOB } from "@workspace/ai/rag/ingest";
import { chooseWebSearch } from "@workspace/ai/search/choose";
import { createSearchBackend } from "@workspace/ai/search/from-config";
import { startTelemetry } from "@workspace/ai/telemetry/otel";
import { authRouter } from "@workspace/auth/handlers";
import type { HandlerContext } from "@workspace/auth/handlers/context";
import {
  type Auth,
  type AuthSession,
  createAuth,
  type PasswordHasher,
} from "@workspace/auth/server";
import type { AppConfig } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { logDecision } from "@workspace/db/queries/decisions";
import {
  type ConnectorDeps,
  disabledServersFor,
  enabledServersFor,
} from "@workspace/mcp/connector-service";
import { createMcp } from "@workspace/mcp/create";
import { loadKeyRing } from "@workspace/mcp/crypto";

import { createArtifactsRouter } from "./api/artifacts";
import { createConnectorsRouter } from "./api/connectors";
import { createDecisionsRouter } from "./api/decisions";
import { createFilesRouter } from "./api/files";
import { databaseProbe, downProbe, jobsProbe } from "./api/health";
import { createKeysRouter } from "./api/keys";
import { createMcpRouter } from "./api/mcp";
import { createMetaRouter, createPublicConfigRouter } from "./api/meta";
import {
  createSandboxRouter,
  disabledSandboxApi,
  type SandboxApi,
} from "./api/sandbox";
import { createSharedResourceLoader } from "./api/shared";
import { runtimeOriginOf } from "./api/sites";
import { createUsageRouter } from "./api/usage";
import { type App, createApp } from "./app";
import { type DatabaseProblem, openDatabase } from "./boot/database";
import type { Session, SessionResolver } from "./context";
import { mountArtifactImageRoutes } from "./http/artifact-images";
import { mountFileRoutes } from "./http/files";
import { mountLlmRoute } from "./http/llm";
import { MCP_OAUTH_CALLBACK_PATH, mountMcpRoutes } from "./http/mcp";
import { enqueueJob, type JobHandlers } from "./jobs/registry";
import { type JobRuntime, startJobs } from "./jobs/start";
import { scheduleTestChatPrune } from "./jobs/test-chats";
import { createKeyStore, orgKeyPolicy } from "./keys/db-key-store";
import { createFileHandlers } from "./knowledge/files";
import { createKnowledgeJobs } from "./knowledge/ingestion";
import { createSearchHandlers } from "./knowledge/search";
import { createLibraryRouter } from "./library/router";
import { linkPreviewsFromEnv } from "./link-preview/from-env";
import type { Storage } from "./ports/storage";
import type { ImageModels } from "./runs/images";
import type { WebSearchSource } from "./runs/retrieval";
import type { SandboxToolSource } from "./runs/sandbox";
import {
  createServices,
  registerCoreJobs,
  type Services,
  type ServicesOptions,
} from "./services";
import { createStorage } from "./storage/from-config";

// The whole server from the environment (025/038), for `apps/web` and later
// `apps/worker`. In order: database (Postgres from DATABASE_URL, else the
// embedded PGlite in `.data/`), auth, the provider registry and key store,
// the Decider, the embedder, storage, MCP, sandboxes, the job queue with
// every job registered, then every router behind one Hono app, plus the
// plain HTTP routes (auth, downloads, OAuth callbacks, the `/api/llm` proxy).
//
// Every piece degrades instead of failing boot (AGENTS.md): no secret in
// production turns sign-in off, no embedding model turns indexing off, no
// S3 credentials make uploads say why, and a database that can't be opened
// leaves the app answering 503 on the routes that need one.

type Env = Readonly<Record<string, string | undefined>>;

/** The sandbox package bound to this instance's providers, once for the API and the turns. */
export interface BoundSandbox {
  /** The `sandbox` procedure group (the panel). */
  readonly api: SandboxApi;
  /** The chat's sandbox tools for runs; the same providers, so the panel sees what the agent did. */
  readonly turnTools: SandboxToolSource;
}

/** What the shell binds from `@workspace/sandbox` (a package that depends on this one). */
export type SandboxBinding = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly report: (message: string, cause: unknown) => void;
  readonly storage: Storage;
}) => BoundSandbox;

export interface ServerFromEnvOptions
  extends Pick<ServicesOptions, "access" | "keyStore" | "tools"> {
  readonly config: AppConfig;
  /** Where the embedded database and other local state live; `./.data` by default. */
  readonly dataDir?: string;
  readonly env?: Env;
  /** Handlers beyond this package's and 021's (evals, later). */
  readonly jobHandlers?: JobHandlers;
  /** How often idle job workers poll, in seconds (pg-boss's default is 2; tests go faster). */
  readonly jobPollingSeconds?: number;
  /** Boot notices for whoever runs the server (the embedded-database line). */
  readonly log?: (message: string) => void;
  /** Tests only: Better Auth's default hashing is deliberately slow. */
  readonly passwordHasher?: PasswordHasher;
  /** Tests only: a registry serving mock models. */
  readonly registry?: ProviderRegistry;
  /** Failures worth a log line; never given secrets. */
  readonly report?: (message: string, cause: unknown) => void;
  /** Overrides the auth session lookup (tests without sign-in). */
  readonly resolveSession?: SessionResolver;
  readonly routers?: Readonly<Record<string, AnyRouter>>;
  /** The sandbox handlers bound to their providers; without it the group says it's off. */
  readonly sandbox?: SandboxBinding;
}

export interface Server {
  readonly app: App;
  /** `null` when sign-in is off (production without BETTER_AUTH_SECRET) or there's no database. */
  readonly auth: Auth | null;
  readonly config: AppConfig;
  /** `null` when the database couldn't be opened. */
  readonly db: Db | null;
  readonly jobs: JobRuntime | null;
  /** Why there's no database, when there isn't one. */
  readonly problem: DatabaseProblem | null;
  /** The signed-in caller for a request, as every route sees it. */
  readonly resolveSession: SessionResolver;
  readonly services: Services | null;
  /** Graceful shutdown: running runs settle as cancelled, jobs drain, pools close. */
  readonly stop: () => Promise<void>;
}

const signedOut: SessionResolver = () => Promise.resolve(null);

const TRAILING_SLASHES = /\/+$/;

/** The public origin: `BETTER_AUTH_URL`, else what a local `bun dev` serves. */
const appOriginOf = (env: Env): string =>
  (
    env.BETTER_AUTH_URL?.trim() ||
    `http://localhost:${env.PORT?.trim() || "3000"}`
  ).replace(TRAILING_SLASHES, "");

/**
 * The local storage driver's URL-signing secret, derived from the auth
 * secret (Q24) so links survive a restart without another variable. Only a
 * configured secret counts: the dev fallback is public, and a random
 * per-process secret is safer than one anyone can read.
 */
export const storageSigningSecret = (env: Env): string | undefined => {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  return secret
    ? createHmac("sha256", secret)
        .update("local storage signed URLs")
        .digest("base64url")
    : undefined;
};

/**
 * One auth session lookup per request, shared by every route and by both
 * procedure contexts: the server's `{ userId }` and the auth handlers'
 * Better Auth session are the same object.
 */
const sessionResolverFor = (auth: Auth): SessionResolver => {
  const seen = new WeakMap<Request, Promise<Session | null>>();
  return (request) => {
    const cached = seen.get(request);
    if (cached) {
      return cached;
    }
    const lookup = auth.api
      .getSession({ headers: request.headers })
      .then((found) =>
        found ? { ...found, userId: found.user.id as UserId } : null
      )
      .catch(() => null);
    seen.set(request, lookup);
    return lookup;
  };
};

const byProvider = (config: AppConfig): ChatKeys =>
  Object.fromEntries(
    instanceKeysFromConfig(config).map((key) => [key.provider, key])
  );

type Report = (message: string, cause: unknown) => void;

/** The server when the database can't be opened: public config, and 503s. */
const withoutDatabase = (
  options: ServerFromEnvOptions,
  env: Env,
  problem: DatabaseProblem,
  stop: () => Promise<void>
): Server => {
  const { config } = options;
  const resolveSession = options.resolveSession ?? signedOut;
  return {
    app: createApp({
      resolveSession,
      routers: {
        ...createPublicConfigRouter({
          config,
          env,
          health: {
            database: downProbe("the database isn't available"),
            jobs: downProbe("the job queue needs the database"),
          },
        }),
        ...options.routers,
      },
      services: null,
    }),
    auth: null,
    config,
    db: null,
    jobs: null,
    problem,
    resolveSession,
    services: null,
    stop,
  };
};

const describeProblem = (problem: DatabaseProblem): string =>
  problem.type === "invalid_url"
    ? "DATABASE_URL is invalid; running without a database"
    : `the embedded database didn't open (${problem.message}); running without a database`;

/** Whether the registry reads provider catalogs (the built one does). */
const discovers = (
  registry: ProviderRegistry
): registry is DiscoveringRegistry => "catalog" in registry;

/** `generate_image`'s models (138): only a discovering registry lists them. */
const imageModelsOf = (registry: ProviderRegistry): ImageModels | undefined =>
  discovers(registry) ? registry : undefined;

/**
 * Ingestion runs in the background with no chat to bill, so instance keys
 * pay for embeddings (Q25); a keyless local model needs none.
 */
const embedderFor = (
  config: AppConfig,
  registry: ProviderRegistry,
  report: Report
): Embedder | null => {
  const embedded = createEmbedder(config, {
    keys: byProvider(config),
    registry,
  });
  if (embedded.ok) {
    return embedded.value;
  }
  if (embedded.error.type === "unavailable") {
    report(`file indexing is off: ${embedded.error.message}`, null);
  }
  return null;
};

/**
 * `web_search` for runs (D23): the provider's own search when the turn's
 * model has it and `search.native` allows, otherwise ours over the
 * configured backend. A backend that's named but can't be built (no key,
 * no URL) is reported once and leaves only native search.
 */
const webSearchFor = (
  config: AppConfig,
  env: Env,
  report: Report
): WebSearchSource | undefined => {
  if (!config.features.webSearch) {
    return;
  }
  const backend = createSearchBackend(config, { env });
  if (!backend.ok && backend.error.backend !== "none") {
    report(`web search has no backend: ${backend.error.message}`, null);
  }
  return (model) => {
    const choice = chooseWebSearch({
      backend: backend.ok ? backend.value : null,
      config,
      model,
      // Every turn has function tools beside it: the workspace's, the
      // artifact tools, memory. Search that can't share a request with
      // them (Gemini 2's) gives way to ours.
      withFunctionTools: true,
    });
    return choice.kind === "none" ? null : choice.tool;
  };
};

/** Registers every job, puts the schedules on, and queues boot-time work. */
const startBackgroundWork = async ({
  db,
  embedder,
  extra,
  queue,
  report,
  services,
  storage,
}: {
  readonly db: Db;
  readonly embedder: Embedder | null;
  readonly extra: JobHandlers | undefined;
  readonly queue: JobRuntime["queue"];
  readonly report: Report;
  readonly services: Services;
  readonly storage: Storage;
}) => {
  await registerCoreJobs(queue, services, {
    ...createKnowledgeJobs({ db, embedder, queue, storage }),
    ...extra,
  });
  const scheduled = await scheduleTestChatPrune(queue);
  if (!scheduled.ok) {
    report("couldn't schedule the test chat cleanup", scheduled.error);
  }
  if (embedder) {
    // Changing `embeddings.model` re-embeds what was indexed with the old
    // one (PLAN.md §8 RAG step 4); with nothing to do the job is a no-op.
    await enqueueJob(queue, REINDEX_EMBEDDINGS_JOB, { model: embedder.model });
  }
};

/** Uploads queue ingestion; without a queue they still store and attach. */
const noQueue = {
  enqueue: () =>
    Promise.resolve({
      error: { message: "no job queue", type: "unavailable" as const },
      ok: false as const,
    }),
};

export const createServerFromEnv = async (
  options: ServerFromEnvOptions
): Promise<Server> => {
  const { config } = options;
  const env = options.env ?? process.env;
  const report = options.report ?? (() => undefined);
  const log = options.log ?? (() => undefined);
  // AI SDK traces over OTLP when `observability.otlp` is set (D21); a no-op otherwise.
  const telemetry = startTelemetry(config.observability, { report });

  const opened = await openDatabase({
    dataDir: options.dataDir ?? "./.data",
    env,
    log,
  });
  if (!opened.ok) {
    report(describeProblem(opened.problem), null);
    return withoutDatabase(options, env, opened.problem, telemetry.shutdown);
  }
  const { database } = opened;
  const { db } = database;
  const origin = appOriginOf(env);

  const created = createAuth({
    config,
    db,
    env,
    log: { warn: log },
    passwordHasher: options.passwordHasher,
  });
  if (!created.ok) {
    report(
      "BETTER_AUTH_SECRET is not set in production: sign-in is off until it is",
      null
    );
  }
  const auth = created.ok ? created.value : null;
  const resolveSession =
    options.resolveSession ?? (auth ? sessionResolverFor(auth) : signedOut);

  const registry: ProviderRegistry =
    options.registry ?? buildRegistry(config, { log });
  // Secrets at rest (D24): provider keys and MCP header secrets. A missing
  // key in production only stops new secrets being stored.
  const keyRing = loadKeyRing(env, { warn: log });
  // Keys from the database (user, team, org) and app.config.yaml (instance).
  const keyStore =
    options.keyStore ??
    createKeyStore({
      config,
      db,
      keys: keyRing,
      report: (skipped) =>
        report(`a stored provider key couldn't be opened (${skipped.reason})`, {
          keyId: skipped.keyId,
        }),
    });
  const orgPolicy = orgKeyPolicy(db, config);

  // The Decider on whichever keys pay for the chat it's deciding for (D17).
  const decider = (keys: ChatKeys): Decider =>
    createDecider(config, {
      keys,
      logDecision: (entry) => {
        logDecision(db, entry).catch((cause: unknown) =>
          report("couldn't log a decision", cause)
        );
      },
      registry,
    });
  const embedder = embedderFor(config, registry, report);

  const storage = createStorage(config, {
    baseUrl: `${origin}/api/storage`,
    env,
    signingSecret: storageSigningSecret(env),
  });
  if (storage.problem) {
    report(`uploads are unavailable: ${storage.problem}`, null);
  }

  const mcp = createMcp({
    config,
    db,
    env,
    oauthRedirectUrl: `${origin}${MCP_OAUTH_CALLBACK_PATH}`,
    warn: log,
  });
  // Connectors (184): the operator's catalog, each user's library and choices.
  const connectorDeps: ConnectorDeps = {
    catalog: mcp.registry.catalog,
    db,
    userServers: config.mcp.userServers,
  };

  const sandbox = options.sandbox?.({
    config,
    db,
    report,
    storage: storage.storage,
  });

  const jobs = await startJobs({
    connection: database.jobs,
    pollingIntervalSeconds: options.jobPollingSeconds,
    report,
  });
  const services = createServices({
    access: options.access,
    config,
    db,
    jobs: jobs?.queue ?? null,
    keyStore,
    listen: database.listen,
    registry,
    report,
    storage: storage.storage,
    storageDriver: storage.driver,
    tools: {
      // Whether an OpenAI-compatible model reasons, from its catalog (105).
      catalog: discovers(registry) ? registry.catalog : undefined,
      decider,
      // `generate_image`'s models (138), which only the built registry lists.
      images: imageModelsOf(registry),
      knowledge: embedder ? { embedder } : undefined,
      // Agent runs leave out what the user or operator turned off (184).
      mcpDisabledFor: (userId) => disabledServersFor(connectorDeps, userId),
      mcpFor: (userId) => mcp.manager.toolSource(userId),
      // Plain chats: every server the caller has on (078, 184).
      mcpServersFor: (userId) => enabledServersFor(connectorDeps, userId),
      orgPolicy,
      sandbox: sandbox?.turnTools,
      webSearch: webSearchFor(config, env, report),
      ...options.tools,
    },
  });
  if (jobs) {
    await startBackgroundWork({
      db,
      embedder,
      extra: options.jobHandlers,
      queue: jobs.queue,
      report,
      services,
      storage: storage.storage,
    });
  }

  // Runs a crash left `running` fail as interrupted before anyone can
  // resume them; this process is the only executor in M1 (D4).
  const recovered = await services.executor.recover();
  if (recovered > 0) {
    log(
      `[runs] ${recovered} run(s) interrupted by the last shutdown were marked failed`
    );
  }

  const loadSharedResource = createSharedResourceLoader(db);
  const sandboxApi = sandbox?.api ?? disabledSandboxApi;
  const authContext = (
    request: Request,
    session: Session | null
  ): HandlerContext | null =>
    auth && {
      appUrl: env.BETTER_AUTH_URL?.trim() || new URL(request.url).origin,
      auth,
      config,
      db,
      headers: request.headers,
      loadSharedResource,
      // The same object as the server's session (`sessionResolverFor`).
      session: session as unknown as AuthSession | null,
    };

  const app = createApp({
    context: (request, session) =>
      Promise.resolve(authContext(request, session) ?? {}),
    resolveSession,
    routers: {
      ...createMetaRouter({
        config,
        db,
        env,
        health: { database: databaseProbe(db), jobs: jobsProbe(jobs !== null) },
        keyStore,
        orgPolicy,
        registry,
      }),
      ...createKeysRouter({ config, db, keys: keyRing, registry }),
      ...createUsageRouter({ db }),
      ...createDecisionsRouter({ db }),
      ...createArtifactsRouter({
        access: services.access,
        db,
        kinds: services.artifactKinds,
        sites: {
          kinds: services.artifactKinds,
          publicLinks: config.features.publicLinks,
          runtimeOrigin: runtimeOriginOf(env.ARTIFACTS_ORIGIN),
          workspace: sandboxApi,
        },
      }),
      ...createLibraryRouter({
        db,
        defaultModel: config.models.default,
        keys: keyRing,
        userServers: config.mcp.userServers,
      }),
      ...createFilesRouter({
        db,
        files: createFileHandlers({
          config,
          db,
          embedder,
          queue: jobs?.queue ?? noQueue,
          storage: { driver: storage.driver, storage: storage.storage },
        }),
        search: createSearchHandlers({ db }),
      }),
      ...createMcpRouter({ db, manager: mcp.manager }),
      ...createConnectorsRouter(connectorDeps),
      ...linkPreviewsFromEnv({ config, env, log }),
      ...createSandboxRouter({ api: sandboxApi, db }),
      ...(auth ? authRouter : {}),
      ...options.routers,
    },
    routes: (hono) => {
      if (auth) {
        hono.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
      }
      mountArtifactImageRoutes(hono, {
        access: services.access,
        db,
        resolveSession,
      });
      mountFileRoutes(hono, {
        db,
        resolveSession,
        signingSecret: storage.signingSecret,
        storage: storage.storage,
      });
      mountMcpRoutes(hono, { manager: mcp.manager, resolveSession });
      mountLlmRoute(hono, {
        budget: services.budget,
        config,
        db,
        decider,
        keyStore,
        orgPolicy,
        registry,
        report,
        resolveSession,
      });
    },
    services,
  });

  return {
    app,
    auth,
    config,
    db,
    jobs,
    problem: null,
    resolveSession,
    services,
    stop: async () => {
      await services.stop();
      await jobs?.stop();
      await mcp.manager.close();
      await database.close();
      await telemetry.shutdown();
    },
  };
};

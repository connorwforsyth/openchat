import type { AnyRouter } from "@orpc/server";
import { buildRegistry } from "@workspace/ai/providers/registry";
import type { AppConfig } from "@workspace/config/schema";
import { connectFromEnv } from "@workspace/db/client";
import postgres from "postgres";

import { type App, createApp } from "./app";
import type { SessionResolver } from "./context";
import type { JobHandlers } from "./jobs/registry";
import { type JobRuntime, startJobs } from "./jobs/start";
import {
  createServices,
  registerCoreJobs,
  type Services,
  type ServicesOptions,
} from "./services";
import { postgresListen } from "./stream/listen";

// The whole server from the environment, for `apps/web` (025) and later
// `apps/worker`. With no DATABASE_URL it still returns a working app: the
// chat routes answer 503 and no jobs run.

export interface ServerFromEnvOptions
  extends Pick<ServicesOptions, "access" | "keyStore" | "report" | "tools"> {
  readonly config: AppConfig;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Handlers from other workstreams (ingestion, evals). */
  readonly jobHandlers?: JobHandlers;
  readonly resolveSession: SessionResolver;
  readonly routers?: Readonly<Record<string, AnyRouter>>;
}

export interface Server {
  readonly app: App;
  readonly jobs: JobRuntime | null;
  readonly services: Services | null;
  /** Graceful shutdown: running runs settle as cancelled, jobs drain, pools close. */
  readonly stop: () => Promise<void>;
}

export const createServerFromEnv = async (
  options: ServerFromEnvOptions
): Promise<Server> => {
  const env = options.env ?? process.env;
  const report = options.report ?? (() => undefined);
  const connection = connectFromEnv(env);
  if (!connection.ok) {
    if (connection.error.type === "invalid_url") {
      report("DATABASE_URL is invalid; running without a database", null);
    }
    return {
      app: createApp({
        resolveSession: options.resolveSession,
        routers: options.routers,
        services: null,
      }),
      jobs: null,
      services: null,
      stop: () => Promise.resolve(),
    };
  }
  const url = env.DATABASE_URL?.trim() ?? "";
  // LISTEN holds a connection of its own; one is plenty for every stream.
  const listener = postgres(url, { max: 1, onnotice: () => undefined });
  const jobs = await startJobs({
    connection: { connectionString: url },
    report,
  });
  const services = createServices({
    access: options.access,
    config: options.config,
    db: connection.value.db,
    jobs: jobs?.queue ?? null,
    keyStore: options.keyStore,
    listen: postgresListen(listener),
    registry: buildRegistry(options.config),
    report,
    tools: options.tools,
  });
  if (jobs) {
    await registerCoreJobs(jobs.queue, services, options.jobHandlers);
  }
  return {
    app: createApp({
      resolveSession: options.resolveSession,
      routers: options.routers,
      services,
    }),
    jobs,
    services,
    stop: async () => {
      await services.stop();
      await jobs?.stop();
      await listener.end();
      await connection.value.close();
    },
  };
};

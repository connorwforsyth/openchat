import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stringify } from "yaml";

import { startMockLlm } from "../../../e2e/support/mock-llm";
import { startMockSearch } from "../../../e2e/support/mock-search";
import {
  assertPortFree,
  REPO_ROOT,
  type RunningServer,
  superviseBoot,
} from "./server";

// The app for live mode: the production build of apps/web, as
// `e2e/support/serve.ts` boots it (an empty temporary directory, the
// embedded database, fresh secrets), but with the providers and aliases of
// the person's own app.config.yaml and the model under test as the default.
//
// The providers block is copied as written, `${NAME}` references and all,
// and only the variables it names are passed to the app: no key is read
// here or written anywhere. Embeddings and web search stay on the local
// stand-ins, so the only real calls are to the model under test (answers
// and titles).

/** The stand-in provider's id; not a name a person's config would use. */
const STAND_IN = "evals-stand-in";

export interface LiveServerOptions {
  /** The person's `models.aliases`, as written. */
  readonly aliases: unknown;
  /** Env variables the providers block names; only these reach the app. */
  readonly env: readonly string[];
  /** The model under test, a `provider:model` ref. */
  readonly model: string;
  readonly port: number;
  /** The person's `providers`, as written. */
  readonly providers: Readonly<Record<string, unknown>>;
}

/** The app.config.yaml a live run boots with. Pure. */
export const liveConfig = ({
  aliases,
  files,
  llm,
  model,
  providers,
  search,
}: Pick<LiveServerOptions, "aliases" | "model" | "providers"> & {
  readonly files: string;
  readonly llm: string;
  readonly search: string;
}): string =>
  stringify({
    auth: { signup: "invite" },
    decider: { adapter: "none" },
    embeddings: { dimensions: 384, model: `${STAND_IN}:embed` },
    limits: { requestsPerMinute: 1000 },
    models: {
      ...(aliases && typeof aliases === "object" ? { aliases } : {}),
      default: model,
    },
    providers: {
      ...providers,
      [STAND_IN]: { baseURL: llm, type: "openai-compatible" },
    },
    sandbox: { default: "just-bash" },
    search: { backend: "searxng", searxng: { url: search } },
    storage: { driver: "local", path: files },
    version: 1,
  });

export const startLiveServer = async (
  options: LiveServerOptions
): Promise<RunningServer> => {
  const { env, port } = options;
  await assertPortFree(port);
  const dir = await mkdtemp(join(tmpdir(), "evals-live-"));
  const [llm, search] = await Promise.all([startMockLlm(), startMockSearch()]);
  const teardown = async () => {
    await Promise.all([llm.close(), search.close()]);
    await rm(dir, { force: true, recursive: true });
  };
  try {
    const configPath = join(dir, "app.config.yaml");
    await writeFile(
      configPath,
      liveConfig({
        ...options,
        files: join(dir, "files"),
        llm: llm.baseUrl,
        search: search.url,
      })
    );
    // The embedded database finds its migrations under the working
    // directory's node_modules, as it does in apps/web.
    await mkdir(join(dir, "node_modules/@workspace"), { recursive: true });
    await symlink(
      join(REPO_ROOT, "packages/db"),
      join(dir, "node_modules/@workspace/db"),
      "dir"
    );
    const web = join(REPO_ROOT, "apps/web");
    const next = createRequire(join(web, "package.json")).resolve(
      "next/dist/bin/next"
    );
    const passed = Object.fromEntries(
      env.flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]]]
      )
    );
    const child = spawn(
      process.execPath.endsWith("bun") ? "node" : process.execPath,
      [next, "start", web, "--port", String(port)],
      {
        cwd: dir,
        env: {
          ...passed,
          BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
          BETTER_AUTH_URL: `http://localhost:${port}`,
          CONFIG_PATH: configPath,
          ENCRYPTION_KEY: randomBytes(32).toString("base64"),
          HOME: process.env.HOME,
          NEXT_TELEMETRY_DISABLED: "1",
          NODE_ENV: "production",
          PATH: process.env.PATH,
          PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return await superviseBoot(child, `http://localhost:${port}`, teardown);
  } catch (cause) {
    await teardown().catch(() => undefined);
    throw cause;
  }
};

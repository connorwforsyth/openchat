import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startMcpFixture } from "@workspace/mcp/testing/fixture-server";

import { BRAND_NAME } from "./brand";
import { startMockLlm } from "./mock-llm";
import { startMockSearch } from "./mock-search";

// Playwright's `webServer`: the production build of apps/web as `next start`
// serves it, on an otherwise empty environment, so the app boots the way
// AGENTS.md promises: no DATABASE_URL (the embedded PGlite, migrated at
// boot), no provider keys. Everything it writes lives in a fresh temporary
// directory that is deleted on exit, so every run starts from an empty
// server, where the first sign-up becomes the admin.
//
// The only things set are what production refuses to run without (a
// generated auth secret and encryption key, fresh per run), an
// app.config.yaml whose providers point at the mock model server (and whose
// web search backend and one instance MCP server are local stand-ins too,
// for tools.spec.ts), and loopback as a trusted proxy (for proxy.spec.ts).
//
// `E2E_STANDALONE=1` runs the server the Docker image runs instead: the
// `standalone` build (`NEXT_OUTPUT=standalone next build`), laid out as
// apps/web/Dockerfile lays it out, started with `node server.js`. It checks
// the image's contents without Docker. `E2E_DEV=1` runs `next dev`, to debug
// a failure with React's development warnings.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web");
const port = Number(process.env.E2E_PORT ?? 3100);

interface Mocks {
  /** Where uploads are stored. */
  readonly files: string;
  /** The mock model server's OpenAI-compatible base URL. */
  readonly llm: string;
  /** The MCP fixture server's endpoint (tools: echo, add, whoami). */
  readonly mcp: string;
  /** The SearXNG stand-in. */
  readonly search: string;
}

const config = ({ files, llm: baseURL, mcp, search }: Mocks) => `version: 1
brand: { name: ${BRAND_NAME} }
auth: { signup: invite }
providers:
  # Keyless, like a local Ollama: every context can use it. Its catalog
  # adds parrot and the metadata the picker's preview card shows (099).
  mock: { type: openai-compatible, baseURL: "${baseURL}", models: [echo], discover: true }
  # Needs a key from the chat context (D17), for the key-payer check.
  paid: { type: openai-compatible, baseURL: "${baseURL}", models: [echo], options: { keyless: "false" } }
models:
  default: mock:echo
decider: { adapter: none }
embeddings: { model: mock:embed, dimensions: 384 }
sandbox: { default: just-bash }
storage: { driver: local, path: "${files}" }
# Web search without a real search engine: the SearXNG backend on a stand-in.
search: { backend: searxng, searxng: { url: "${search}" } }
# An instance MCP server, which every chat may use.
mcp: { servers: [{ name: e2e, url: "${mcp}" }] }
limits: { requestsPerMinute: 1000 }
`;

interface Launch {
  readonly args: readonly string[];
  readonly cwd: string;
}

/** `next start` (or `next dev`) on apps/web, from the temporary directory. */
const nextServer = async (dir: string): Promise<Launch> => {
  // The embedded database finds its migrations under the working
  // directory's node_modules, as it does in apps/web.
  await mkdir(join(dir, "node_modules/@workspace"), { recursive: true });
  await symlink(
    join(root, "packages/db"),
    join(dir, "node_modules/@workspace/db"),
    "dir"
  );
  const require = createRequire(join(web, "package.json"));
  const next = require.resolve("next/dist/bin/next");
  const command = process.env.E2E_DEV ? "dev" : "start";
  return { args: [next, command, web, "--port", String(port)], cwd: dir };
};

/** The standalone server, copied the way apps/web/Dockerfile copies it. */
const standaloneServer = async (dir: string): Promise<Launch> => {
  const built = join(web, ".next/standalone");
  if (!existsSync(built)) {
    throw new Error(
      "no standalone build: run `NEXT_OUTPUT=standalone bunx next build` in apps/web"
    );
  }
  const app = join(dir, "app");
  const server = join(app, "apps/web");
  await cp(built, app, { recursive: true, verbatimSymlinks: true });
  await cp(join(web, ".next/static"), join(server, ".next/static"), {
    recursive: true,
  });
  await cp(
    join(root, "packages/db/drizzle"),
    join(server, "node_modules/@workspace/db/drizzle"),
    { recursive: true }
  );
  return { args: [join(server, "server.js")], cwd: server };
};

const main = async () => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-server-"));
  const [llm, search, mcp] = await Promise.all([
    startMockLlm(),
    startMockSearch(),
    startMcpFixture(),
  ]);
  const configPath = join(dir, "app.config.yaml");
  await writeFile(
    configPath,
    config({
      files: join(dir, "files"),
      llm: llm.baseUrl,
      mcp: mcp.url,
      search: search.url,
    })
  );
  const launch = process.env.E2E_STANDALONE
    ? await standaloneServer(dir)
    : await nextServer(dir);

  const child = spawn(
    process.execPath.endsWith("bun") ? "node" : process.execPath,
    launch.args,
    {
      cwd: launch.cwd,
      env: {
        BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
        BETTER_AUTH_URL: `http://localhost:${port}`,
        CONFIG_PATH: configPath,
        ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        HOME: process.env.HOME,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: process.env.E2E_DEV ? "development" : "production",
        PATH: process.env.PATH,
        PORT: String(port),
        // The specs stand in for a proxy on this machine (proxy.spec.ts).
        TRUSTED_PROXIES: "127.0.0.1, ::1",
      },
      stdio: "inherit",
    }
  );

  let stopping = false;
  const stop = async (code: number) => {
    if (stopping) {
      return;
    }
    stopping = true;
    child.kill("SIGTERM");
    await Promise.all([llm.close(), search.close(), mcp.close()]);
    await rm(dir, { force: true, recursive: true });
    process.exit(code);
  };
  child.on("exit", (code) => {
    stop(code ?? 0).catch(() => process.exit(1));
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stop(0).catch(() => process.exit(1));
    });
  }
};

main().catch((cause: unknown) => {
  console.error("[e2e] couldn't start the server:", cause);
  process.exit(1);
});

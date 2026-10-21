# Self-hosted AI chat

A self-hosted, multi-user AI chat platform: agents, MCP tools, files and
retrieval, branching conversations, artifacts and sandboxes, on a TypeScript
stack (Next.js 16, Postgres with pgvector, bun and Turborepo). The product
name is a working codename read from `app.config.yaml` (`brand:`), so this
README calls it "the app". [`PLAN.md`](PLAN.md) is the spec.

## Quick start with Docker

You need Docker with Compose v2. From the repo root:

```sh
cp .env.example .env
docker compose up -d
```

The first start builds the `web` image (a few minutes), starts Postgres,
applies the migrations and serves the app on <http://localhost:3000>. Create
an account: **the first account becomes the administrator**; after that,
people join by invitation (Admin › Members).

With no model configured, the app looks for a local Ollama. To add
providers, either run the guided setup (needs bun, see below):

```sh
bun install
bun run setup          # asks a few questions, writes .env and app.config.yaml
bun run setup up       # builds and starts it, and prints the URL
bun run setup doctor   # checks Docker, ports, config, health and models
```

or copy `app.config.example.yaml` to `app.config.yaml` and edit it. Running
it in Docker, deploying behind TLS, optional services, updates and backups:
[`docs/self-hosting.md`](docs/self-hosting.md).

## Local development

Prerequisites:

- [bun](https://bun.sh) 1.4 (the repo pins `bun@1.4.0` in `package.json`)
- Node.js 22 or newer (Next.js builds and runs on Node; the images use 24)
- Docker, for Postgres and the optional services

```sh
bun install                       # also installs the pre-commit hook
cp .env.example .env              # optional; every variable is optional
docker compose up -d postgres     # Postgres + pgvector on localhost:5432
bun dev                           # http://localhost:3000
```

- **No Docker?** Leave `DATABASE_URL` empty (or skip `.env`) and the server
  runs on an embedded database (PGlite) in `apps/web/.data/pglite`. Fine
  for trying things out, not for deployments.
- `bun run setup` also has a local mode: choose `bun dev` when it asks, and
  `bun run setup up` starts what `bun dev` needs and then runs it.
- The main checkout serves on 3000; a linked git worktree gets its own
  stable port, and `bun dev` prints it. `PORT` overrides both.
- Before writing anything in `apps/web`, read [`AGENTS.md`](AGENTS.md):
  Next.js 16 differs from earlier versions, and the repo has rules for
  types, UI tokens, icons, strings and motion that CI enforces.

## Configuration

- **`.env`**: secrets and service URLs. Every variable is optional and
  documented in [`.env.example`](.env.example); a missing value turns its
  feature off rather than failing the start. In production, set
  `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` yourself or let the `web`
  container generate them once.
- **`app.config.yaml`**: providers, models, sign-up, sandboxes, search,
  icons, fonts and the brand. Start from
  [`app.config.example.yaml`](app.config.example.yaml); secrets are
  referenced as `${ENV_NAME}`, never written in the file. Icons and fonts
  are compiled in, so rebuild the image after changing them
  (`docker compose up -d --build`).

`.env`, `app.config.yaml` and `docker-compose.override.yml` are gitignored.

## Behind a corporate network

Installs download from `registry.npmjs.org`, and Docker builds also pull
base images from Docker Hub. If `bun install` fails behind a proxy:

- **An outbound proxy.** Export `HTTP_PROXY` and `HTTPS_PROXY` before
  `bun install`. For Docker, set it in Docker Desktop (Settings › Resources ›
  Proxies); Docker passes it to builds and containers.
- **TLS interception**, which shows up as `SELF_SIGNED_CERT_IN_CHAIN` or
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Export the company's root CA as PEM
  (on macOS, `security find-certificate -a -p -c "<CA name>" > corporate-ca.pem`)
  and `export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem` before
  `bun install` and `bun dev`.

## Common commands

| Command | What it does |
|---|---|
| `bun dev` | Runs the app (and the workspace watchers) in development |
| `bun run check` / `bun run fix` | Ultracite (Biome) lint and format, check or fix |
| `bun run check:guards` | The repo guards: tokens, icon imports, brand, Lingui |
| `bun run typecheck` | TypeScript across the workspace |
| `bun run test` | Vitest across the workspace |
| `bun run test:e2e` | Playwright against a production build |
| `bun turbo typecheck lint test build` | What CI runs |
| `bun run db:generate` / `bun run db:migrate` | Drizzle migrations (the server also migrates at boot) |
| `bun run i18n:extract` | Re-extract the Lingui catalogs after changing strings |

Filter any turbo task to one package, e.g.
`bun turbo test --filter=@workspace/ui`.

## Project layout

bun workspaces and Turborepo; packages use the `@workspace/*` scope and
ship TypeScript source with no build step.

```
apps/
  web/              Next.js app, with the API at /api
  artifacts/        artifact runtime, served on its own origin
  sandbox-runner/   runs Docker sandboxes (the only service that reaches Docker)
  desktop/          Electron shell around an instance
packages/
  contract/         oRPC + zod contract between client and server
  server/ db/ auth/ ai/ mcp/ sandbox/ config/ ...   the server side
  ui/ chat-ui/ composer/ icons/ i18n/ ...           the client side
  setup/            `bun run setup`
e2e/                Playwright tests
scripts/ci/         repo guards run by `lint`
docs/               self-hosting, desktop, decisions
```

## Further reading

- [`PLAN.md`](PLAN.md): the spec and its decisions (D1–D28)
- [`AGENTS.md`](AGENTS.md): rules for anyone changing the code
- [`docs/self-hosting.md`](docs/self-hosting.md): running and operating an
  instance
- [`docs/desktop.md`](docs/desktop.md): the desktop app
- [`e2e/README.md`](e2e/README.md): the end-to-end tests

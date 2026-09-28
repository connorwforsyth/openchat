---
id: "052"
title: "Setup CLI: start the app and configure it interactively"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Connor (2026-09-28): "Would it make sense to have like a cli to help start the app and configure it to
your needs friendly?" Yes: getting to a running instance today means hand-editing `.env`, copying
`app.config.example.yaml`, writing a `docker-compose.override.yml` to mount it, generating a sandbox token,
and choosing compose profiles and icon build args. The loop did exactly that by hand for the 026 demo.

## Done when

- `bun run setup` (a small workspace package, e.g. `packages/setup` or `apps/cli`, using an OSS prompt
  library such as `@clack/prompts`) walks through, with safe defaults for every answer:
  - **How to run:** Docker (compose) or local dev (`bun dev` + compose Postgres or embedded PGlite).
  - **Models:** which providers (Anthropic, OpenAI, OpenAI-compatible/Ollama), keys typed into the CLI and
    written only to `.env` (masked input, never echoed or logged); default and fast models.
  - **Sign-up:** open / invite / domain; instance name (`brand.name`).
  - **Sandboxes:** just-bash, Docker (adds the `sandbox` profile, generates `SANDBOX_RUNNER_TOKEN`,
    egress none/open with a one-line explanation), or none.
  - **Optional services:** web search (SearXNG profile), artifacts origin.
  - **Icons:** lucide / phosphor / material (+ style), written to `icons` and the build args.
- It writes `.env`, `app.config.yaml` (validated with `packages/config`'s schema before writing) and, for
  Docker, `docker-compose.override.yml` mounting the config with `CONFIG_PATH`. Re-running edits the
  existing files (shows current values as defaults) and never overwrites without asking.
- `bun run setup up` builds and starts (`docker compose --profile … up -d --build --wait`) and prints the URL;
  `bun run setup doctor` checks Docker, ports, config validity, `/api/health?ready=true`, the runner, and
  that a model is reachable, with a fix for each failure.
- `app.config.yaml` and `docker-compose.override.yml` are gitignored. `docs/self-hosting.md` quick start
  leads with `bun run setup`; the manual steps stay documented.
- Unit tests cover answer → files (snapshot the generated files for a few answer sets) and re-run merging.
  No stray `openchat` literals (the brand comes from config). The local gate passes.

## Owns

The new CLI package, root `package.json` (script + catalog), `bun.lock`, `.gitignore`, `docs/self-hosting.md`,
`packages/config` (exports only, if the CLI needs the schema).

## Results (2026-09-28, loop)

Gate (`.tools/gate.sh`): `bun install --frozen-lockfile` no changes; `bun run check` and `check:guards`
clean; `bun turbo typecheck lint test build` 82/82.

- **Package.** `packages/setup` (`@workspace/setup`), run as `bun run setup [up|doctor]` (root script).
  `@clack/prompts` ^1.8.1 (MIT, already in the lockfile via ultracite) added to the catalog. Strings are
  plain English, not Lingui: a terminal tool, and the catalogs/macros are set up for the React apps.
  No `packages/config` change was needed (`./parse` and `./schema` were already exported).
- **Shape.** Pure core, ports at the edge: `wizard.ts` (questions, over a `Prompter` port; clack adapter
  in `clack.ts`, scripted fake beside the port), `current.ts` (files → defaults), `plan.ts` (answers →
  file contents), `env-file.ts` / `config-file.ts` / `override-file.ts` (in-place edits: comments, order,
  unknown keys and hand additions survive; YAML edited as a document with `yaml`), `up.ts`, `doctor.ts`,
  and `main.ts` + `node-system.ts` as the shell. Errors are `Result`s.
- **Files.** `.env` (from `.env.example` on a first run; written 0600), `app.config.yaml` (from the
  example; validated with `parseConfig` against the `.env` being written, and nothing is written if it
  fails), `docker-compose.override.yml` for Docker (`CONFIG_PATH` + `:ro` mount, plus
  `host.docker.internal:host-gateway` when a compatible provider points at the host). Re-runs start from
  the files, change only what the answers change, and confirm each overwrite naming the changed
  variables/sections (never values). The demo answers reproduce the hand setup: generated
  `SANDBOX_RUNNER_TOKEN`, `SANDBOX_EGRESS=open`, `ICON_SET=material`/`ICON_STYLE=rounded`,
  `sandbox.default: docker`, the override. `app.config.yaml`, `apps/web/app.config.yaml` and
  `docker-compose.override.yml` are gitignored (root-anchored, so guard fixtures stay tracked).
- **Secrets.** Keys come from masked `password` prompts, go into the answers' `keys` and then only
  `.env`; config gets `${NAME}` references. Summaries and confirms show variable names. Tests assert
  no key reaches the config, the override, command arguments or anything shown; snapshots use
  `fake-…-placeholder` keys. The doctor sends a key only to its own provider's model-list endpoint and
  reports status codes, never bodies.
- **`setup up`.** Docker: `docker compose [--profile sandbox|search|artifacts] up -d --build --wait`, then
  the URL (`WEB_PORT`). Local: `docker compose … up -d --wait` for just the needed services (postgres,
  sandbox-runner, searxng), then `bun turbo run dev --env-mode=loose --filter=web [--filter=artifacts]`
  with `.env` and an absolute `CONFIG_PATH` in its environment, because `next dev` reads
  `apps/web/.env`, not the root one, and turbo's strict env mode drops undeclared variables.
- **`setup doctor`.** Read-only: `.env`/override present, config valid (with the app's error lines),
  `docker version`, `docker compose version`, `docker compose ps` to tell our ports from someone else's,
  `/api/health?ready=true` (with the down checks), runner `/healthz` and an unsigned `/v1` call (503 =
  no token), and each provider's free model list; a fix line under every failure; exit 1 on failure.
- **Tests.** 57 Vitest tests, Docker never touched (fake runner/HTTP/ports): answers → files snapshots
  for three answer sets (demo, local PGlite + Ollama + services, Docker with all providers), re-run
  merging (defaults read back, no-op re-run, token kept, hand edits kept, provider removal cleans
  model refs), the wizard driven by scripted answers (questions asked, overwrite confirms, decline,
  cancel, invalid config, masked keys), `up` plans and failures, doctor scenarios. Also driven once in
  a pty with a fake key (masked on screen, `.env` 0600, `docker compose config` valid with the
  override), then those files deleted; `doctor` run read-only in the worktree.
- **Found, not fixed (outside Owns).** The schema's local storage default `./.data/files` resolves to
  `/app/apps/web/.data/files` in the image, outside the `web-data` volume (`apps/web/data`), so Docker
  uploads are lost when the container is recreated. The CLI writes `storage.path: ./data/files` in
  Docker mode to avoid it; the default itself (config schema or Dockerfile) wants its own ticket.

## Resolution (2026-09-28, loop)

Merged in [PR #42](https://github.com/connorwforsyth/openchat/pull/42). `bun run setup`, `setup up`, `setup doctor` in `packages/setup`; 57 tests; gate 82/82. Found: Docker uploads live outside the data volume ([053](053-docker-upload-storage.md)).

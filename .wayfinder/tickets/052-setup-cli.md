---
id: "052"
title: "Setup CLI: start the app and configure it interactively"
labels: [wayfinder:build]
status: open
assignee: loop
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

---
id: "053"
title: "Docker: uploads land outside the data volume"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

052 found that in the Docker image the local storage default `./.data/files` resolves to
`/app/apps/web/.data/files`, outside the `web-data` volume (`/app/apps/web/data`), so uploaded files are lost
whenever the `web` container is recreated (e.g. `docker compose up -d` after an `.env` change). The setup CLI
works around it by writing `storage.path: ./data/files` in Docker mode.

## Done when

- A fresh `docker compose up` with no `app.config.yaml` (and with the example config) stores uploads inside the
  `web-data` volume; recreating `web` keeps them. Pick the smallest fix that keeps `bun dev` storing under
  `./.data` (e.g. the image sets the storage default via env, or the volume covers the path) and say why.
- The example config, `docs/self-hosting.md` and the setup CLI agree (drop the CLI workaround if no longer needed).
- A test covers the resolved path; the local gate passes. If Docker is used, use a separate compose project and
  tear it down; don't touch the running `openchat` demo stack.

## Owns

`apps/web/Dockerfile`, `docker-compose.yml`, `packages/config/src/**`, `packages/setup/**`, `app.config.example.yaml`,
`docs/self-hosting.md`, `packages/server/src/**` (storage wiring only).

## Results (2026-09-28, loop)

Gate (`.tools/gate.sh`): `bun install --frozen-lockfile` no changes; `bun run check` and `check:guards`
clean; `bun turbo typecheck lint test build` 82/82. (One earlier gate run had `@workspace/db#test` fail
under load; it passed alone and on the re-run. That package was not touched.)

- **Fix: the image links `./.data` into the volume.** `apps/web/Dockerfile` now runs
  `mkdir -p data && chown node:node data && ln -s data .data` in `/app/apps/web`. The default
  `storage.path` (`./.data/files`) and the path in any config copied from the example (old or new) now
  resolve to `/app/apps/web/data/files`, inside `web-data`. `bun dev` still writes to the git-ignored
  `./.data`. This is the smallest fix: one line in the image, and no change to the schema, the compose
  mount or the entrypoint, so existing volumes and their `.secrets.env` stay where they are. An
  env-driven default would have missed configs that spell out `./.data/files`. It also means that
  `docker run` of the image without `DATABASE_URL` keeps PGlite in the volume.
- **Config and docs.** `app.config.example.yaml` keeps `./.data/files` and says `.data` is the volume in
  the image. The schema comment says the same, and so does the compose volume comment.
  `docs/self-hosting.md` gains an "Uploaded files" subsection, plus a note under "Updating" on copying
  uploads out of a container built from an older image.
- **Setup CLI.** The per-mode `STORAGE_PATHS` is now one `STORAGE_PATH = "./.data/files"`. The old
  Docker path `./data/files` (`LEGACY_DOCKER_STORAGE_PATH`) is kept on a Docker re-run, because it's the
  same directory in the new image and the right one in an old image. Local mode still moves it back to
  `./.data/files`. Snapshots were updated for the new example comment and the Docker path.
- **Test.** `packages/setup/src/docker-storage.test.ts` reads the real Dockerfile (runtime `WORKDIR`,
  `ln -s` links) and `docker-compose.yml` (the `web-data` mount). It checks that the schema default (no
  `app.config.yaml`), the example's path, what setup writes for Docker and the legacy path all resolve
  into the volume in the image, and that the default, the example's path and setup's local path stay in
  `.data` under `bun dev`. Removing the `ln -s` makes 3 of its cases fail.
- **Docker.** `docker compose -p t053 config` shows the unchanged mount (`web-data` →
  `/app/apps/web/data`). A throwaway image (node:24-bookworm-slim with the same `WORKDIR`, `RUN` line
  and `USER node`) and a named volume showed that a write to `./.data/files/...` lands in
  `data/files` and survives a new container. The probe image and volume were removed. The full image
  wasn't built.
- **Existing installs.** Connor's demo config already has `storage.path: ./data/files`, which is in the
  volume, so it needs nothing. An install on the old default had its uploads in the container's own
  layer; copy them out before the rebuild (docs, "Updating").

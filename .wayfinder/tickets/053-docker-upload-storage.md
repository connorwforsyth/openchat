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

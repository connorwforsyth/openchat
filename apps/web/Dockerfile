# syntax=docker/dockerfile:1
# The web app (PLAN.md D6): Next.js `standalone` with the API at /api, on
# Node 24. Built from the repo root so the workspace packages are in the
# context:
#   docker build -f apps/web/Dockerfile .
# `docker compose up` builds and runs it with Postgres (docs/self-hosting.md).
# The server applies database migrations itself at boot (041), under a lock,
# so replicas starting together migrate once; no migrate step here.

# bun installs and runs turbo; Next builds and runs on Node, so the build
# stage is Node with bun copied in (pinned like the other images).
FROM oven/bun:1.4.2 AS bun

FROM node:24-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY . .
# Scripts are skipped: git hooks have no place in an image, and the Lingui
# catalogs and the icon set are turbo tasks the build runs itself.
RUN bun install --frozen-lockfile --ignore-scripts
# The icon set is compiled in (D19), and the image is built before any
# app.config.yaml is mounted, so it comes in as build args; `icons:select`
# reads them from the environment. Empty ones leave it to an app.config.yaml
# in the build context, if any, and then the defaults.
#   docker build -f apps/web/Dockerfile --build-arg ICON_SET=material .
ARG ICON_SET= \
    ICON_STYLE= \
    ICON_WEIGHT= \
    ICON_FILL=
# `NEXT_OUTPUT=standalone` switches next.config.ts to a traced, self-contained
# server; `bun dev` and `next start` are unaffected.
RUN NEXT_OUTPUT=standalone bunx turbo run build --filter=web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# The traced server keeps the monorepo layout (apps/web/server.js beside the
# workspace packages and node_modules it needs), and runs from apps/web:
# relative paths (the file store's ./data, app.config.yaml) resolve there.
WORKDIR /app/apps/web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone/ /app/
# Static assets aren't traced.
COPY --from=build --chown=node:node /repo/apps/web/.next/static/ ./.next/static/
# Read from disk at boot to migrate the database, where the server looks
# (`findMigrationsFolder`: node_modules/@workspace/db/drizzle).
COPY --from=build --chown=node:node /repo/packages/db/drizzle/ ./node_modules/@workspace/db/drizzle/
COPY --chmod=755 apps/web/docker-entrypoint.sh /usr/local/bin/web-entrypoint
# Uploads and the generated secrets live here; compose mounts a volume on it.
RUN mkdir -p data && chown node:node data
# Never root, and never the Docker socket (D24): sandboxes go through the
# sandbox-runner service.
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["web-entrypoint"]
CMD ["node", "server.js"]

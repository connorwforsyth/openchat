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
# A network that intercepts TLS (most corporate proxies) re-signs every
# connection with its own root CA, which bun and Node don't trust, so the
# install fails with SELF_SIGNED_CERT_IN_CHAIN or similar. PEM files in
# certs/ are added to the trusted roots (docs/self-hosting.md). With none the
# bundle is empty and bun isn't pointed at it (it warns about an empty one).
# Scripts are skipped: git hooks have no place in an image, and the Lingui
# catalogs and the icon set are turbo tasks the build runs itself.
RUN cat certs/*.pem certs/*.crt > /usr/local/share/extra-ca.pem 2>/dev/null; \
    if [ -s /usr/local/share/extra-ca.pem ]; then \
      export NODE_EXTRA_CA_CERTS=/usr/local/share/extra-ca.pem; \
    fi && \
    bun install --frozen-lockfile --ignore-scripts
# The icon set (D19) and the fonts (129) are compiled in from the `icons`
# and `fonts` blocks of an app.config.yaml in the build context:
# apps/web/app.config.yaml, else the repo root's (the one `bun run setup`
# writes and compose mounts at runtime). With neither, the defaults.
# The ICON_* build args are only for an image built without a config file:
# they're ignored, with a warning in the build log, while a config has an
# `icons` block (130).
#   docker build -f apps/web/Dockerfile --build-arg ICON_SET=material .
ARG ICON_SET= \
    ICON_STYLE= \
    ICON_WEIGHT= \
    ICON_FILL=
# `NEXT_OUTPUT=standalone` switches next.config.ts to a traced, self-contained
# server; `bun dev` and `next start` are unaffected. CONFIG_PATH here only
# reaches the select steps (turbo passes `build` itself nothing but
# NEXT_OUTPUT), and isn't in the runtime image.
RUN if [ ! -f apps/web/app.config.yaml ] && [ -f app.config.yaml ]; then \
      export CONFIG_PATH=/repo/app.config.yaml; \
    fi && \
    NEXT_OUTPUT=standalone bunx turbo run build --filter=web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# The traced server keeps the monorepo layout (apps/web/server.js beside the
# workspace packages and node_modules it needs), and runs from apps/web:
# relative paths (the file store's ./.data/files, app.config.yaml) resolve
# there.
WORKDIR /app/apps/web
# The same roots for the server's own outbound calls (model providers);
# Node ignores an empty bundle quietly.
COPY --from=build /usr/local/share/extra-ca.pem /usr/local/share/extra-ca.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/extra-ca.pem
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone/ /app/
# Static assets aren't traced.
COPY --from=build --chown=node:node /repo/apps/web/.next/static/ ./.next/static/
# Read from disk at boot to migrate the database, where the server looks
# (`findMigrationsFolder`: node_modules/@workspace/db/drizzle).
COPY --from=build --chown=node:node /repo/packages/db/drizzle/ ./node_modules/@workspace/db/drizzle/
COPY --chmod=755 apps/web/docker-entrypoint.sh /usr/local/bin/web-entrypoint
# Uploads and the generated secrets live here; compose mounts a volume on it.
# `.data` links into it. That's where `bun dev` keeps local state, including
# the default `storage.path` (./.data/files), which would otherwise land in
# the container's own layer and be lost whenever `web` is recreated.
RUN mkdir -p data && chown node:node data && ln -s data .data
# Never root, and never the Docker socket (D24): sandboxes go through the
# sandbox-runner service.
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["web-entrypoint"]
CMD ["node", "server.js"]

# syntax=docker/dockerfile:1
# The artifact runtime (PLAN.md D24): a static page and a tiny file server,
# built from the repo root so the workspace packages it imports are in the
# context:
#   docker build -f apps/artifacts/Dockerfile .
# The page and the server are bundled, so the runtime image needs no
# node_modules and no package manager.

FROM oven/bun:1.4.2 AS build
WORKDIR /repo
COPY . .
# Scripts are skipped: the runtime needs no Lingui catalogs or git hooks.
# Optional CA and .npmrc build secrets, as in apps/web/Dockerfile.
RUN --mount=type=secret,id=ca,required=false \
    --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi && \
    bun install --frozen-lockfile --ignore-scripts --filter artifacts
# Except the icon set's selection (D19), which writes the module that
# @workspace/icons exports and site-ui's blocks draw with (163).
RUN cd packages/icons && bun scripts/select.ts
RUN cd apps/artifacts && bun run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
# Inside the container; compose publishes it on the host's loopback only.
ENV ARTIFACTS_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/artifacts/dist/ ./dist/
USER node
EXPOSE 3910
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3910/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]

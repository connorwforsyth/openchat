# syntax=docker/dockerfile:1
# sandbox-runner (PLAN.md D7): built from the repo root so the workspace
# packages it imports are in the context:
#   docker build -f apps/sandbox-runner/Dockerfile .
# The runner is bundled into one file, so the runtime image needs no
# node_modules and no package manager.

FROM oven/bun:1.4.2 AS build
WORKDIR /repo
COPY . .
# Scripts are skipped: the runner needs no Lingui catalogs or git hooks.
RUN bun install --frozen-lockfile --ignore-scripts --filter sandbox-runner
RUN cd apps/sandbox-runner && bun run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/sandbox-runner/dist/ ./
# Never root: Docker access comes from the socket proxy, not from privileges.
USER node
EXPOSE 7070 7071
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7070/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "main.js"]

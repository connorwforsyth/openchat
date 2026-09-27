---
id: "048"
title: "Material Symbols icon set, icons.set from config, lucide only as fallback"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

`PLAN.md` §11 "Icons" says switching `icons.set` to `material` and rebuilding changes every icon. 046
found (follow-ups C and D) that there's no Material set, `icons.set` in `app.config.yaml` isn't read
(only the `ICON_SET` env var), and lucide stays in the bundle under any set.

## Done when

- `src/sets/material.ts` generated from `@material-symbols/svg-*` (Apache-2.0), honouring the config's
  style / weight / fill (D19), with gaps falling back to lucide and reported by `icons:gaps`.
- `icons:select` reads `icons.set` from `app.config.yaml` (`CONFIG_PATH`), `ICON_SET` still overrides, and
  turbo's cache keys on the choice.
- A Docker image gets its set at build time (build arg in `apps/web/Dockerfile` + compose + `docs/self-hosting.md`).
- Under a non-lucide set, only the lucide icons the set lacks are bundled (check the build output).
- Built with `icons.set: material`, shadcn primitives, AI Elements, the file tree and Markdown render Material icons.

## Owns

`packages/icons/**`, `packages/config/src/schema.ts` (icons block only), `turbo.json`, `apps/web/Dockerfile`,
`docker-compose.yml`, `docs/self-hosting.md`, `app.config.example.yaml`, `package.json` catalog entry.

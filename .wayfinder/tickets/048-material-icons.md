---
id: "048"
title: "Material Symbols icon set, icons.set from config, lucide only as fallback"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results (2026-09-28, loop)

Gate (`.tools/gate.sh`): `bun run check` and `check:guards` clean; `bun turbo typecheck lint test build` 79/79.

- **Material set.** `packages/icons/src/sets/material.ts` maps 102 of 103 names to Material Symbols
  as `fromMaterial(glyph.<symbol>)`. Only `GitBranchIcon` is a gap (Material has no git-branch
  glyph; `BranchIcon`, the conversation branch, draws `call_split`). `icons:select` generates
  `src/sets/material.glyphs.ts` (gitignored) from `@material-symbols/svg-<weight>` in the
  configured style, weight and fill: one path string per symbol, drawn by `fromMaterial` in
  `sets/adapters.tsx` (a plain function component, so it renders in Server Components). The seven
  `@material-symbols/svg-100…700` packages (Apache-2.0, 0.47.5) are in the root catalog and are
  devDependencies of `packages/icons`. `sets.test.ts` checks every mapped symbol exists as a
  single path in all 42 variants. `icons:gaps` reports `material (web): 102/103, falls back to
  lucide for GitBranchIcon`.
- **`icons.set` from config.** `icons:select` reads the `icons` block of `app.config.yaml` the way
  the server does (`CONFIG_PATH`, else `app.config.yaml`, relative to `apps/web`), interpolates
  `${ENV}` with the config package's `interpolateEnv` and validates with its `iconsSchema` (now
  exported from `packages/config/src/schema.ts`), so the rest of the file never blocks a build.
  `ICON_SET`, `ICON_STYLE`, `ICON_WEIGHT` and `ICON_FILL` override it; blank ones don't. A missing
  `CONFIG_PATH` only warns (a deployment may set it for a runtime mount); a bad `icons` block or
  YAML fails with the key or variable named. Turbo's `icons:select` keys on those variables,
  `CONFIG_PATH`, `app.config.yaml` at the repo root and in `apps/web`, and the config parser and
  schema; `web#build` inherits it (checked with `--dry=json`: the build hash changes with
  `ICON_WEIGHT` and with the config file). `ICON_SET` left `build.env`, since the dependency hash
  covers it.
- **Docker.** `apps/web/Dockerfile` takes `ICON_SET`/`ICON_STYLE`/`ICON_WEIGHT`/`ICON_FILL` build
  args; compose passes them from `.env`; `docs/self-hosting.md` has an "Icon set" section.
  `docker build --check` is clean and `docker compose config` shows the args; running
  `turbo run icons:select` with those variables set (as the `RUN` step does) picks the set. I
  didn't build the image.
- **Lucide only for gaps.** 046's finding reproduced first: a phosphor build had all 93 lucide
  glyphs in three client chunks, because importing any name from `sets/lucide.ts` keeps every
  lucide module it imports. `selected.ts` now re-exports a set's gaps straight from `lucide-react`
  (`export { PanelRight as PanelRightIcon } from "lucide-react"`), so the bundler follows each to
  its own module. Rebuilt with phosphor: client chunks hold only `octagon-x`, `network`, `wallet`,
  `key-round`, `rotate-ccw-clock` (History) and `mail`, all phosphor gaps. With material, no
  lucide icon is in the client or server output (its one gap isn't rendered), and 13 unused
  Material glyphs are shaken out too. Lucide as the chosen set is unchanged (typed `Icon` exports
  from `sets/lucide.ts`).
- **Material renders.** Built `apps/web` with `apps/web/app.config.yaml` = `icons: { set:
  material, style: rounded }` (removed afterwards) and served it with `next start` and
  `ENABLE_DEV_ROUTES=1`. Every SVG on `/dev/chat` (85: sidebar, header, buttons, message actions,
  composer), `/dev/ai-elements` (22: tool, message actions, Streamdown table and code-block
  buttons) and `/dev/code` (13) has Material's `0 -960 960 960` viewBox; none are 24×24. The file
  tree's six `ws-tree-*` sprite symbols in its shadow root are Material. (@pierre/diffs' own
  16×16 sprite and the tree's status dot are theirs, as before.)

Left for later:
- The install cost: each weight package is ~14 MB and 23,565 files, so seven add ~165k files to
  every `bun install` (and the Docker build stage). If that hurts, the alternative is a committed
  snapshot of just the mapped symbols (~1.7 MB for all 42 variants) and no dependency.
- `app.config.example.yaml` says "Copy to app.config.yaml" beside it (the repo root), but the
  server resolves `app.config.yaml` from `apps/web`, its working directory, so a root copy is only
  read with `CONFIG_PATH`. `icons:select` follows the server. Not changed here.
- Native Material (`material.native.ts`) isn't built; native falls back to lucide as before.

## Resolution (2026-09-28, loop)

Merged in [PR #39](https://github.com/connorwforsyth/openchat/pull/39). Material Symbols (102/103 names), `icons.set` read from config with env overrides and turbo keys, Docker build args, lucide bundled only for gaps. Verified with a material production build and bundle checks; local gate 79/79. Follow-up: vendor only the mapped Material symbols instead of seven ~14 MB packages ([051](051-vendor-material-glyphs.md)).

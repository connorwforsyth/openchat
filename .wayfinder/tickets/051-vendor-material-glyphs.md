---
id: "051"
title: "Vendor only the mapped Material symbols"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

048 added the seven `@material-symbols/svg-*` packages (about 14 MB and 23.5k files each, ~165k files in
every `bun install` and Docker build stage) to generate glyphs for the ~100 mapped names. Committing just
the mapped symbols (about 1.7 MB for all 42 style/weight/fill variants) would drop the dependency.

## Done when

- A script regenerates the vendored glyph data from the packages on demand (run by hand when names change,
  not on install), and the packages leave the default install.
- `icons:select` builds material from the vendored data; `icons:gaps` and the variant test still pass.
- `bun install` file count drops accordingly; the local gate passes.

## Owns

`packages/icons/**`, root `package.json` catalog, `bun.lock`.

## Results (2026-09-28, loop)

Gate (`.tools/gate.sh`): `bun install --frozen-lockfile` no changes; `bun run check` and `check:guards`
clean; `bun turbo typecheck lint test build` 79/79.

- **Vendored data.** `packages/icons/vendor/material-symbols/svg-<weight>.json`, one file per weight
  (the packages' split, so `icons:select` reads one ~200–290 KB file and each stays under Biome's
  1 MiB limit): `{ package, version, variants: { "<style>[-fill]": { <symbol>: <path d> } } }`, keys
  sorted, 93 symbols (the 102 mapped names share some) × 42 variants, 1.65 MB in all. Deduplicating
  identical paths across variants would get it to ~1.0 MB but makes diffs unreadable, so it doesn't.
  `LICENSE` (copied from the package) and `NOTICE` (Google, Apache-2.0, the release, what was
  taken: each SVG's `<path d>` unchanged) sit beside it. Checked against the installed 0.47.5
  packages before removing them: 3,906/3,906 paths identical.
- **Regeneration.** `bun run icons:vendor [release]` (`scripts/vendor.ts`) installs the seven
  packages into a temp dir (`bun install --ignore-scripts --no-save`), reads the `glyph.<symbol>`
  references in `sets/material.ts`, and writes nothing unless every symbol is a single path in a
  `0 -960 960 960` box in every variant; it removes the temp dir either way. With no argument it
  keeps the vendored release. The pure part (`vendorWeight`, reading through a `readSvg` port,
  `renderVendoredWeight`, `pickGlyphs`) is in `scripts/material.ts` with tests. Ran it for real:
  ~19 s.
- **`icons:select`** parses the configured weight's file with `vendoredWeightSchema` and picks the
  variant; a symbol mapped without regenerating fails with "isn't vendored for … run `bun run
  icons:vendor`". `material.glyphs.ts` names the vendored file and release. Turbo needed no change:
  `$TURBO_DEFAULT$` already hashes `vendor/**` into `icons:select` (checked with `--dry=json`).
- **Tests.** `sets.test.ts` now checks the vendored data covers every mapped symbol in all 42
  variants (from the config schema's styles and weights). `icons:gaps`: `material (web): 102/103,
  falls back to lucide for GitBranchIcon`, unchanged.
- **Install.** The seven packages left the root catalog and `packages/icons` devDependencies;
  `bun.lock` lost 28 lines. Fresh `bun install --frozen-lockfile` in this worktree: before 1,195
  packages, 245,524 files, 2.0 GB, 16.8 s; after 1,188 packages, 80,569 files, 1.4 GB, 9.4 s
  (−164,955 files, exactly the seven packages). An incremental `bun install` on an existing checkout
  reported "7 packages removed" but left their `node_modules/.bun` store dirs until node_modules was
  wiped.
- **Material renders.** Built `apps/web` with `apps/web/app.config.yaml` = `icons: { set: material,
  style: rounded }` (removed afterwards), served it with `next start` and `ENABLE_DEV_ROUTES=1`,
  and read the server-rendered HTML: every SVG on `/dev/chat` (48), `/dev/ai-elements` (20) and
  `/dev/code` (13) has Material's `0 -960 960 960` viewBox, none 24×24; all 32 distinct paths on
  `/dev/chat` are the vendored rounded 400 paths (27 differ from outlined).

Left for later:
- `PLAN.md` D19 (line 479) and the dependency list (line 1013) still say Material is generated from
  `@material-symbols/svg-*`; true of the vendored data, but they don't mention the vendoring. Not
  owned here.
- The root `NOTICE` lists ported code only; the Material attribution lives in
  `packages/icons/vendor/material-symbols/NOTICE`. Add a pointer there if the root file should be
  the single index.

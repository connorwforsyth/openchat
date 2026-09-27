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

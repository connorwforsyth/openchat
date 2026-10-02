---
id: "141"
title: "knip finds unused files, dependencies and exports (ratcheted)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/engineering.md` §2). Biome catches unused code inside a file, but nothing finds unused files, unused dependencies or unused exports across ~25 packages that 130+ agent tickets have written. T3 gates this with knip (`t3:knip.jsonc`), turning the `--exports` check on one workspace at a time as each comes clean.

## Done when

- `knip.jsonc` at the root: `types`/`nsTypes` off, `includeEntryExports` for `packages/*`, the shadcn component set in `packages/ui/src/components/**` ignored, non-import entry points listed with a comment each (`scripts/ci/cli.ts`, `.wayfinder/frontier.ts`, `e2e/**`, setup CLI, `fonts:select`, `icons:select`, desktop main/preload, `vitest.config.ts` files).
- `bun run knip` passes for files and dependencies across the repo. Real findings are removed in this PR, each listed in the PR body; anything uncertain is listed in `ignore` with a reason instead of deleted.
- `--exports` is gated for the packages already clean; the rest are listed as the ratchet (a comment says to add a package once it's clean).
- It runs in `check:guards` (or its own root task in the gate) and in CI.
- Gate and e2e pass.

## Owns

`knip.jsonc` (new), root `package.json` (scripts, devDependency), `.github/workflows/ci.yml` (one step), `turbo.json` (if a task is added), and deletions of files and dependencies knip proves unused (no behaviour change; list them).

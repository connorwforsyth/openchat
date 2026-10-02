---
id: "148"
title: "Desktop: a test checks the built preloads on Linux CI"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/desktop.md` §3.3). Both preloads are sandboxed, and the instance preload imports zod and `@workspace/shortcuts/ids`. A regression (pulling in Lingui or a Node built-in) is only caught by `test:desktop`, which is macOS-only and not in CI. T3 parses its built preload, rejects dynamic `import()`/`require()` of anything a sandboxed preload can't reach, runs it in `node:vm` with a stub `electron`, and checks the bridge keys (`t3:apps/desktop/scripts/verify-preload-bundle.mjs`).

## Done when

- A Vitest test in `apps/desktop` builds (or reads the built) `dist/preload/*.cjs`, runs each in a `node:vm` context with a stub `electron` (`contextBridge`, `ipcRenderer`) and only the modules a sandboxed preload may `require`, and asserts the exact keys exposed on `window.desktop` (and the setup bridge).
- It runs on Linux in the normal `bun turbo test` (no Electron binary needed).
- Gate passes.

## Owns

`apps/desktop/src/preload/*.test.ts` (or `apps/desktop/scripts/`), `apps/desktop/package.json` (test wiring), `apps/desktop/vitest.config.ts`.

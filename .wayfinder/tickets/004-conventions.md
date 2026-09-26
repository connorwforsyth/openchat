---
id: "004"
title: "AGENTS.md conventions and CI guards"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["002"]
---

## Question

Write down the rules every later agent follows, and enforce the mechanical ones in CI
(`PLAN.md` §10 Phase 0, steps 4 and 8; D5, D8, D12, D18, D19).

- `AGENTS.md` (with `CLAUDE.md` pointing at it): functional core / imperative shell,
  zod-first, `Result` errors, no classes outside adapters, the token rules, icons via
  `@workspace/icons`, strings via Lingui macros, the contract-change process, how to run
  things, and where Next 16 docs live (`node_modules/next/dist/docs`).
- CI guards (as scripts in `scripts/ci/`, wired into `lint`):
  - no raw hex colours or Tailwind palette classes in apps and UI packages;
  - no direct imports of icon libraries outside `packages/icons`;
  - no `openchat` literal outside the allowed places (D18);
  - `lingui extract` fails on missing or unused keys (can be a no-op until 006 lands).

## Owns

`AGENTS.md`, `CLAUDE.md`, `scripts/ci/`, additions to `biome.json` and `turbo.json`.

## Done when

- Each guard has a failing-fixture test proving it catches a violation.
- CI green.

---
id: "078"
title: "S0: close the harness gaps the audit found"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Stage of the eve assessment (`docs/proposals/2026-09-30-eve-assessment.md`): no migration to eve; adopt its patterns in
our own packages. Connor agreed on 2026-09-30. Read that document's Evidence and "Recommended staged plan" sections first.

## Done when

- **Web search in runs.** `web_search` is passed to turns when `features.webSearch` is on: wire `chooseWebSearch` and
  `createSearchBackend` (`packages/ai/src/search/{choose,from-config,backends}.ts`) into the builtins at
  `packages/server/src/server.ts:410-417`. Native provider search is used when the model has it; otherwise the configured backend.
- **MCP in plain chats.** Plain model chats get the user's, team's and org's MCP servers they're allowed to use (`turn.ts`
  `modelTurn` 441-472, `packages/mcp/src/manager.ts` `toolSource`), not only agents that list them.
- **Configurable step limit.** `limits.agentMaxSteps` in config (default 20), passed through `services.ts` to `runAgent`.
- **Artifacts at runtime.** `create_artifact` / `update_artifact` tools using `saveArtifactVersion` and the `:::artifact` format
  from `packages/ai/evals/artifacts/format.ts`; the artifact card and Workspace panel show them.
- e2e covers each (mock search backend, a mock MCP server, an artifact created and updated). Gate passes.
- No `packages/contract` change without Connor's approval (config schema lives in `packages/config`).

## Owns

`packages/ai/src/{search,tools,agent}/**`, `packages/server/src/{server.ts,services.ts,runs/turn.ts,runs/retrieval.ts}`, `packages/config/src/schema.ts` (limits), `packages/mcp/src/manager.ts`, `e2e/**`. Coordinate with PR #63 (it edits `server/src/runs/executor.ts`): branch from main and avoid that file.

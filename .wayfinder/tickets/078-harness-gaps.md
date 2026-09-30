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

## Results (2026-09-30, loop)

Built on branch `t/078-harness-gaps` (not pushed, no PR yet). No `packages/contract` change.

**What was built**

- **Step limit.** `limits.agentMaxSteps` (default 20, 1–200) in `packages/config/src/schema.ts`; `services.ts` passes it to the
  executor's existing `maxSteps`, which `runAgent` already took. Documented in `docs/self-hosting.md`.
- **Web search in runs.** `server.ts` builds the backend once (`createSearchBackend`) and hands turns a `WebSearchSource` over
  `chooseWebSearch`. `runs/retrieval.ts` (`webSearchTools`) offers `web_search` unless the composer sent `webSearch: "off"`;
  plain chats get it through the same retrieval gate as `file_search` (one Decider call for both), agents when their version
  lists `web_search` (the Agent Builder already offers it). Native provider search when the model has it, else the backend.
  `choose.ts` gained `withFunctionTools`: Gemini 2's search can't share a request with function tools (the provider drops
  them all), so such a turn uses the backend instead.
- **MCP in plain chats.** `listUsableServers` (`packages/mcp/src/manager.ts`) lists the instance's servers, those owned by the
  user or a team or org they're in, and those granted to any of them: `canUseServer`'s rule as a list. `turn.ts`
  (`chatMcpTools`) plans them through the same `resolveTools` + `buildToolSet` an agent uses, with the agent schema's default
  approvals. A server that's down or needs sign-in is skipped. At most 100 MCP tools per plain chat.
- **Artifacts at runtime.** `packages/ai/src/tools/artifacts.ts`: `create_artifact` and `update_artifact` over an
  `ArtifactStore` port, bound per run in `services.ts` (`dbArtifactStore`, over `saveArtifactVersion` and `listArtifacts`).
  Content is validated by writing the call out as the `:::artifact` directive and reading it back with the eval's
  `parseArtifacts`, so the tool and the eval agree on every fixture. `run-agent.ts` lifts each saved artifact's
  `artifact-ref` into the stream and the stored answer, so the existing card and Workspace panel show it with no UI change.
  `update_artifact` names the artifact by the id `create_artifact` returned (the table has no `identifier` column).

**Approvals (nothing loosened)**

- `web_search`: no prompt in plain chats, like `file_search`; an agent's own `approvals` apply in agents.
- MCP tools in plain chats: what an agent that lists the server with default approvals gets today (`auto`, no prompt).
- `create_artifact` / `update_artifact`: **ask**, in plain chats and in agents (unless an agent sets them to `auto` by name),
  the pattern `write`/`edit` follow. Every version waits for an Approve.

**Verified**

- Gate (`.tools/gate.sh`): `Tasks: 82 successful, 82 total`, no other output.
- `E2E_PORT=3178 bun turbo test:e2e`: 48 passed, 0 failed, 0 skipped. New `e2e/tests/tools.spec.ts` (4 tests): a cited
  web search over a SearXNG stand-in (`e2e/support/mock-search.ts`), `webSearch: "off"`, an MCP tool call against
  `@workspace/mcp`'s fixture server as an instance server, and an artifact created then updated (cards, panel, versions).
- Unit and run-level tests: `packages/ai/src/tools/artifacts.test.ts`, `packages/server/src/runs/harness-gaps.test.ts`
  (web search with citations, MCP for owner / grantee / org member / stranger, artifacts through approval, the step limit),
  `choose.test.ts`, `schema.test.ts`. ai 307, server 215, mcp 40, config 53, all passing.

**Outside Owns** (both one line, neither in another ticket's paths)

- `packages/ai/package.json`: the `./tools/artifacts` export, so the server can import the new module.
- `bun.lock` and `e2e/package.json`: `@workspace/mcp` as an e2e dev dependency, for the fixture server.

**Left, and questions for Connor**

- Should artifacts ask? They do, to match the most conservative comparable tool. Artifacts are versioned and render on a
  separate origin, so `auto` is defensible; it's a two-line change in `turn.ts`.
- MCP tools in plain chats run without a prompt (the agent default). Every usable server is offered in every plain chat;
  there is no per-chat switch and no Decider selection yet (D15 "context selection").
- With default config, plain chats on Anthropic, OpenAI and Gemini 3 models now get the provider's native search
  (`features.webSearch` and `search.native` both default to true). The provider bills those searches to whichever key
  pays for the chat. Native search has no run-level test here (no real provider is ever called).
- No org-level switch for native search exists to feed `chooseWebSearch`'s `nativeAllowed`; the composer has no web search
  toggle either (`options.webSearch` is honoured when a client sends it).
- The Agent Builder doesn't list the artifact tools, so an agent only gets them if its definition names them.
- No prompt tells the model when to make an artifact beyond the tools' descriptions (S1 / ticket 079's territory).
- `app.config.example.yaml` doesn't show `agentMaxSteps`: `packages/setup` snapshots that file, which is outside Owns.

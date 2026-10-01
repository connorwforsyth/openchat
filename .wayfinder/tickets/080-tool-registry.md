---
id: "080"
title: "S2: a tool registry, one file per tool"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["079"]
---

## Question

Stage of the eve assessment (`docs/proposals/2026-09-30-eve-assessment.md`): no migration to eve; adopt its patterns in
our own packages. Connor agreed on 2026-09-30. Read that document's Evidence and "Recommended staged plan" sections first.

Connor decided PRs #60, #63 and #65 on 2026-09-30 and they are merged, so this can start. It is stacked on 078 (PR #69) and 079 (PR #68), which are drafts.

## Done when

- New `packages/ai/src/tools/registry/`: `defineTool({name, description, input (zod), output?, execute(input, ctx), approval?, capability?})`
  with our own `ctx` (actor, conversation, workspace, abort signal, emit); one file per built-in tool (`read`, `write`, `edit`,
  `bash`, `preview`, `file_search`, `web_search`, `update_memory`, `create_artifact`); an `index.ts` registry.
- `toAiSdkTool(def, ctx)` adapts to `ToolLoopAgent`; MCP and client tools adapt into the same shape.
- `approval` holds a declarative default only. The policy engine stays as the permissions proposal specifies and is not decided here.
- The old factories remain as thin wrappers for one release. A golden snapshot shows tool names, schemas and descriptions
  unchanged. Tool-calling evals and e2e pass. Gate passes.

## Owns

`packages/ai/src/tools/**`, `packages/sandbox/src/tools/**`, `packages/server/src/knowledge/file-search-tool.ts`, `packages/ai/src/memory/tool.ts`, tests.

## Results (2026-10-01, loop)

Built on `t/080-tool-registry`, stacked on 078 and 079 (unmerged drafts #69 and #68). Not pushed, no PR.

**Commits**

- `d973af3` golden snapshot, on the code as it was
- `238d174` `defineTool`, `toAiSdkTool`, the registry, and the five `@workspace/ai` built-ins as definitions
- `53a1644` the five sandbox tools as definitions, and the registry of all ten
- `5bfa0c1` `fileSearchToolFor` binds the `file_search` definition

**Layout** (the README in `packages/ai/src/tools/registry/` explains it)

- Packages depend `sandbox` → `server` → `mcp` → `ai`, so `@workspace/ai` can't import the sandbox or the server.
- `packages/ai/src/tools/registry/` holds `define.ts`, `to-ai-sdk.ts`, `adapt.ts` (MCP and client tools), `index.ts` (`createToolRegistry`, `aiBuiltinTools`), and one file each for `file_search`, `web_search`, `update_memory`, `create_artifact` and `update_artifact`.
- `packages/sandbox/src/tools/defs/` holds `bash`, `read`, `write`, `edit` and `preview`, one file each. What they share is in `workspace.ts` and `file-change.ts`. The `Sandbox` port is unchanged.
- `packages/sandbox/src/tools/registry.ts` assembles all ten (`builtinTools`). It's the first package that can see them all.
- Files are kebab-case (`file-search.ts`), because the lint rule rejects `file_search.ts`.

**Golden snapshot**

- `packages/sandbox/src/tools/__snapshots__/tool-golden.json.snap`, written by `golden.test.ts` in the same folder.
- It resolves real turns (the production resolver and memory wrapper on PGlite, just-bash, an in-process MCP server) and records each tool as the mock model was sent it, plus `Turn.toolApproval`.
- It covers a plain chat (13 tools: 5 sandbox, `file_search` over an attachment, `web_search`, `update_memory`, both artifact tools, 3 MCP tools), `update_memory` in `propose` mode, an agent with approvals `auto`, the same agent with `ask` and two overrides, and a client tool.
- `git diff d973af3 HEAD -- packages/sandbox/src/tools/__snapshots__/tool-golden.json.snap` is empty.

**Approval defaults**

- Declarative only. Nothing reads them to decide a call; the resolver, `resolveTools` and `withMemory` are unchanged.
- `registry.test.ts` in the sandbox package holds them to `chatSandboxApproval`, `FILE_CHANGE_TOOLS`, `ARTIFACT_TOOLS` and the golden snapshot.

**Call sites**

- `packages/server/src/runs/{turn,sandbox,retrieval,memory,executor}.ts` and `services.ts`: no change.
- `packages/sandbox/src/handlers/turn-tools.ts`: no change.
- `fileSearchToolFor` (owned) now binds the definition. The old factories are thin wrappers with the same names and signatures.

**Verified**

- Gate: `Tasks: 82 successful, 82 total`, nothing else reported.
- `bun turbo eval`: 18 evals in 3 files, 100%.
- `E2E_PORT=3178 bun turbo test:e2e`: 48 passed.
- `@workspace/ai`: 335 tests (10 new). `@workspace/sandbox`: 167 tests (6 new).
- No existing test or snapshot was modified. The 079 prompt snapshot, the 074 path tests and the 072 abort tests pass untouched.

**Not done, and open questions**

- `createFileSearchTool` in `packages/ai/src/rag/file-search.ts` is not a thin wrapper. The tool was written there, not in the server file the ticket names, and that file is outside Owns. The definition reuses its schemas and `searchFiles` but repeats its description, result mapping and model text (about 50 lines). A test holds the two to the same description, schemas and results. No run calls the old factory now. Folding it in is a small follow-up if Connor allows the file.
- `packages/sandbox/package.json` gained `@workspace/ai` (dependency) and `@workspace/mcp` (devDependency, for the golden test). Both are workspace links already reached through the server; `bun.lock` has two new lines. No new external package.
- The old modules re-export what moved, under one `biome-ignore lint/performance/noBarrelFile` each, with the reason. Remove them with the wrappers after one release.
- `update_memory`'s default is `auto`, the default memory mode. A user in `propose` mode is asked, as before; that stays a user setting applied by `withMemory`.
- `capability` is descriptive. `resolveTools` still gets its sets from the turn resolver.
- Client tools reach a tool set only through `buildToolSet`; no run passes any today, so the snapshot takes that one from `buildToolSet` directly.

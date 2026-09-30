---
id: "080"
title: "S2: a tool registry, one file per tool"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["079"]
---

## Question

Stage of the eve assessment (`docs/proposals/2026-09-30-eve-assessment.md`): no migration to eve; adopt its patterns in
our own packages. Connor agreed on 2026-09-30. Read that document's Evidence and "Recommended staged plan" sections first.

**Wait for Connor's decisions on PRs #60, #63 and #65 before starting** (they edit `packages/sandbox/src/tools/tools.ts` and `server/src/runs/*`).

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

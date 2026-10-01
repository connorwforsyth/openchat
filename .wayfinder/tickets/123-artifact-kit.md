---
id: "123"
title: "Artifact framework: kinds as definitions, today's kinds moved onto it"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

The artifact framework (`docs/proposals/2026-10-01-artifact-framework.md`, PR #76, with Connor's answers in `.wayfinder/QUESTIONS-FOR-CONNOR.md`, "Answered 2026-10-01"). Connor: "artefacts framework keen as well" (2026-10-02). Additive contract routes for the Artifacts page are approved, each in its own PR.

Phase 1 builds the framework and moves the existing kinds onto it, with no behaviour change, the way S2 did for tools.

## Done when

- New `packages/artifacts-kit`: `defineArtifactKind({ kind, label, icon, content (zod), instructions (a prompt fragment), checks[], operations, render, editor, diff, export, capabilities })`, shared checks (size, imports allowlist, compiles), and a registry.
- Today's kinds (html, react, svg, mermaid, markdown, code) become definitions. `create_artifact` / `update_artifact` validate through each kind's checks; a failed check is a tool error the model can fix, and nothing is saved.
- **Golden snapshot first:** artifact tool names, schemas and descriptions, and the artifacts prompt fragment, are unchanged. Existing rows render as before.
- Gate, evals and e2e pass. No `packages/contract` change in this ticket.

## Owns

`packages/artifacts-kit/**` (new), `packages/ai/src/tools/registry/{create-artifact,update-artifact}.ts`, `packages/ai/src/prompts/fragments/artifacts.md`, `apps/artifacts/**` (render keyed by kind), tests.

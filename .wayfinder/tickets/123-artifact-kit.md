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

## Results (2026-10-02, loop)

Built on `t/123-artifact-kit`, not pushed. Commits: `7097b05` (golden snapshots on the unrefactored code), `43c133c` (the kit; the tools check through it), `7f5cf5c` (test strings the icon guard misread), `944c973` (the runtime renders by the kind's definition).

- **`packages/artifacts-kit`** (new, pure: zod, contract, shared, and the icon *names* only):
  - `defineArtifactKind({ kind, label, icon, content, instructions, checks, operations, render, editor, diff, export, capabilities })` and `defineOperation`, in `define.ts`. `checkArtifact(definition, content)` parses the content schema first, then runs every check in order. Checks are pure and synchronous and return sentences the model reads.
  - Shared checks (`checks.ts`): `sizeLimit`, `matches`, `importsAllowed` (with `importSpecifiers`) and `compiles` (the compiler is passed in, so the kit ships none).
  - `createArtifactKindRegistry` (`registry.ts`): `kinds`, `get`, `list`, `check`, `instructionFiles`. A kind defined twice throws.
  - Today's six kinds are definitions in `src/kinds/`, built on `textKind` (`kinds/text.ts`). Each is text, changed by the `replace` operation, diffed as text, with `editor: "none"` and empty instructions. It has a size cap of 400 000 characters plus the old shape rule, with the same message. React carries `render.imports` (`react`, `react-dom`) and `annotate: true`. `builtin.ts` is the registry, typed against the contract's `ArtifactKind`.
- **Tools:** `saveArtifact` checks the title as the directive did, then runs the kind's checks. A failed check is the existing `invalid` result, and the store is never called. The registry can be passed in (`ports.kinds`, `createArtifactTools(store, kinds?)`), which is where narrower rules plug in later. Tool names, schemas and descriptions are untouched.
- **Runtime:** `apps/artifacts/src/renderers.ts` holds one renderer per `render.runtime`. `main.ts` looks up the kind in the registry instead of switching on it. React's allowlist reads the React kind.
- **No behaviour change:** `git diff 7097b05 HEAD -- '*.snap'` is empty, and so is the diff of both golden test files. The ai golden covers names, descriptions, input and output schemas, approval and capability defaults, the artifacts fragment as composed, and the create and update verdicts for 51 contents × 6 kinds plus 13 titles. The runtime golden covers the kinds and what 17 import specifiers resolve to. `artifact-kinds.test.ts` holds the new checks to the old directive round trip over 1 700+ (kind, content, title) cases.
- **Verified:** `gate.sh` gives 88/88 tasks and `evals --strict: ok`. `E2E_PORT=3280 bun turbo test:e2e` passed 70 of 70.
- **Outside Owns:** `packages/ai/src/tools/{artifact-content,artifacts}.ts`, the registry README, `packages/ai/package.json` and `bun.lock`. These hold the shared save path the two tools use. Nothing in `packages/server`, `packages/contract`, `packages/db` or `packages/chat-ui` changed.

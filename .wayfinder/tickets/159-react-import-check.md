---
id: "159"
title: "React artifacts: imports are checked when they're saved"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

The artifact kinds roadmap (2026-10-16, `.context/research/claude-artifacts/`): each kind is made from a library chosen for it, and a save refuses anything outside it. Ticket 125 left a gap: "The React save-time import check is still not done." A React artifact importing `recharts` saves, then fails when it renders. `importsAllowed` exists in `packages/artifacts-kit/src/checks.ts`, but no kind uses it.

## Done when

- `textKind` (`kinds/text.ts`) takes extra checks after its own.
- `reactKind` adds `importsAllowed(REACT_IMPORTS)`. A bad import fails at save with a sentence the model can act on, naming what it may import. `render.imports` and the `REACT_IMPORTS` export are unchanged, because chat-ui re-exports them.
- Tests: the kit refuses a bad import and accepts `react` and `react-dom`. The JSX runtimes are the transform's to require, not the author's to import. The tool tests in `packages/ai/src/tools/artifact-kinds.test.ts` cover a refused save. The artifact eval fixtures still pass.

## Owns

`packages/artifacts-kit/src/kinds/{text,react}.ts` and their tests, `packages/ai/src/tools/artifact-kinds.test.ts`.

## Results (2026-10-16)

Not committed yet.

- `textKind` takes `checks`, which run after the size and shape checks. `reactKind` passes `importsAllowed(REACT_IMPORTS)`.
- Tests:
  - `builtin.test.ts` covers the refusal and its wording.
  - `artifact-kinds.test.ts`: the "stricter checks" tests now run against the built-in kinds. A new case shows that a narrower layer (`react` only) refuses `react-dom`, which the built-ins accept.
- **Verified:** `bun turbo typecheck test` for `@workspace/artifacts-kit`, `@workspace/ai` and `artifacts` (26/26), and `ultracite` over the changed files.
- **Not run:** the full gate and e2e. No e2e or fixture saves a React artifact with any other import.

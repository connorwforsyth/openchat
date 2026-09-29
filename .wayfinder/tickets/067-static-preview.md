---
id: "067"
title: "Static pages preview without a server"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

For 066's built-in browser, static HTML should preview without the agent starting `npx serve`. There are no contract
changes: the server records a preview the same way the `preview` tool does.

## Done when

- **`ensureStaticPreview(workspace)`** (in `packages/sandbox`) works in workspaces whose provider has ports (Docker):
  - It starts a tiny built-in static file server inside the sandbox on a reserved port (e.g. 4173), serving `/work`:
    Node's `http` module only, correct MIME types, `index.html` for directories, no directory traversal, bound to
    0.0.0.0, started in the background (nohup), idempotent if it's already listening (reuse 063's listener probe).
  - It then exposes the port (`exposePort`) and records the preview (`recordPreview`) so it appears in `sandbox.get`.
  - The server script ships with the sandbox package and is written into the sandbox (e.g. `/home/sandbox/.static-preview.mjs`), not `/work`.
- **Called:**
  - after an agent `write`/`edit` of an `.html` file that was applied;
  - after a user `writeFile`/`importFile` of an `.html` file (059's handlers).
  - Best effort: a failure never fails the write, and is logged.
- **Stops cleanly:** the reserved port doesn't clash with the agent's own servers. If the agent later previews its
  own server, both previews are listed. The idle stop and snapshot/restore behave as before.
- **Agent instructions** (`WORKSPACE_INSTRUCTIONS` / tool descriptions): static HTML/CSS/JS previews automatically,
  so there's no need to start a server for it. Use `preview` for dev servers (Vite etc.).
- **Tests:** unit tests with fake exec/expose (start, idempotent, non-HTML ignored, failure tolerated), and the
  sandbox-runner smoke gains a step: write `index.html` and the static preview URL returns it. Gate passes.

## Owns

`packages/sandbox/src/**` (new `static-preview.ts`; hooks in `tools/tools.ts`, `handlers/turn-tools.ts`,
`handlers/workspace-files.ts`), `packages/server/src/runs/sandbox.ts` (instructions only),
`apps/sandbox-runner/test/e2e/smoke.ts`.

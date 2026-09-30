---
id: "074"
title: "Agent file tools stay inside /work, as D7 promises"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

The 073 proposal found that `resolveSandboxPath` (`packages/sandbox/src/paths.ts:13-38`) only stops a path climbing
above `/`, so the agent's `read`/`write`/`edit` tools accept `/etc/x` or `../../x`. PLAN D7 says file tools are confined
to the workspace. User routes already use 059's `resolveWorkspacePath` (strictly inside `/work`). This ticket restores a
promised boundary, so it tightens rather than broadens.

## Done when

- The agent's `read`/`write`/`edit` (and `preview` if it takes paths) resolve through the same strict workspace rule
  as the user routes. Relative paths resolve against `/work`. Anything outside `/work`, including `..` escapes,
  NUL/control characters and empty paths, returns a tool error the model can act on: "Paths must be inside /work".
- `bash` is unchanged: it's governed by the sandbox itself and the permissions proposal.
- Unit tests cover the traversal cases for each tool, plus a regression test that `/work/...` and relative paths still
  work. Existing tool tests pass. Gate passes.

## Owns

`packages/sandbox/src/{paths.ts,tools/tools.ts}` and their tests.

## Results

Branch `t/074-tool-paths-in-workspace`, not merged.

- **The rule.** 059's `resolveWorkspacePath` moved from `handlers/workspace-files.ts` into `paths.ts` beside
  `resolveSandboxPath`, unchanged: relative paths resolve against `/work`; the result must be strictly inside `/work/`;
  empty/blank, NUL and other control characters, `..` that leaves `/work`, absolute paths elsewhere (`/etc/passwd`,
  `/workx/a`) and `/work` itself are refused. The Files panel routes import it from there.
- **The tools.** `read`, `write` and `edit` (and `proposeSandboxChange`, which builds the review diff) resolve their
  `path` through it before touching the sandbox, and only the checked absolute path reaches `readFile`/`writeFile`. A
  refusal is `{ status: "error", message: "<reason> Paths must be inside /work; relative paths resolve against it." }`.
  Proposals, `onChanged` and not-found messages keep the model's own spelling, so patches and existing messages are
  unchanged. `preview` takes a port, not a path. `bash` is unchanged.
- **Callers checked.** `resolveSandboxPath` stays the providers' loose rule (just-bash, the runner's exec `cwd` and
  file I/O), because internal writes need it: the static preview (067) writes its server to
  `/home/sandbox/.static-preview.mjs` straight through `sandbox.writeFile`, not through a tool. The stale-edit guard
  (056) compares proposals made by the same resolver, so it still matches. `listFiles` walks `WORKDIR`. Nothing gets
  broader.
- **Tests.** `paths.test.ts` has the moved `resolveWorkspacePath` cases plus `/workx/a` and a C1 control character, and
  checks that `resolveSandboxPath` still allows the static preview's path. `tools.test.ts` checks that `read`, `write`,
  `edit` and the review proposal each refuse `/etc/passwd`, `../x`, `/work/../etc/passwd`, `/workx/a`, NUL and empty,
  leaving files and `onChanged` untouched. A regression test checks that `/work/a.txt`, `a.txt` and `sub/../b.txt`
  still work. The new tests fail against the old `tools.ts`. Sandbox package 156/156; gate 82/82.
- **Left (out of scope).** The check is on the path's text, so a symlink inside `/work` that points out is still
  followed. The Files panel routes have the same gap. The run's `@`-mention reads (`workspaceRead` in
  `handlers/turn-tools.ts`, used by `server/runs/workspace-context.ts`) take the person's ref path through the loose
  resolver. That is their own sandbox, and `bash` reads anywhere anyway, but it could use `resolveWorkspacePath` too.

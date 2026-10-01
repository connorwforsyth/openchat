---
id: "106"
title: "Plan mode: a read-only planning run, a plan you can edit, then Approve to build"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor asked for a plan mode, like Claude Code's. It is designed in `docs/proposals/2026-10-01-files-artifacts-plan-mode.md` (PR #76).

His decisions (2026-10-01):
- **Contract:** approved an optional `mode: "plan"` on run options (additive), beside 105's `reasoning` and `fast` (now on main). His words: "Yes, add optional reasoning, fast and mode to run options in packages/contract". Also: "plan mode keen to start" (2026-10-02).
- **Where the plan lives:** both, as a reply in the chat **and** as a Document artifact.
- **Enforcement:** he didn't choose, so the loop's default applies: a narrow built-in read-only rule now, folded into the permissions proposal (073) later.

## Done when

- **Contract:** `mode: "plan"` (optional; absent means normal) on run options, in its own commit, with the OpenAPI regenerated and old shapes still parsing.
- **Switching it on:** a **Plan** switch in the composer's + menu, next to Web search and Fast mode. While on, a quiet "Plan" chip sits by + (like the Search chip).
- **Server: a planning run is read-only.**
  - **Allowed tools:** `read`, `file_search`, `web_search`, and MCP tools only when the server marks them read-only (otherwise left out). `bash` is offered only for an allowlist of read-only commands (`ls`, `cat`, `rg`, `grep`, `find`, `git status|log|diff|show`), checked on the server; anything else is a tool error.
  - **Withheld:** `write`, `edit`, `preview`, `create_artifact`, `update_artifact`, `update_memory`, and any other writing tool. The model never sees them, and a direct call is refused.
  - **Instructions:** a plan fragment (S1's prompt files): investigate, then produce a plan with goal, steps, files to touch, risks and open questions.
- **The plan:**
  - **The reply** shows the plan as its answer, with a plan card: **Approve**, **Edit**, **Discard**.
  - **The artifact:** the plan is also saved as a markdown artifact titled "Plan: …" (the existing artifact store; the Document kind comes later with the artifact framework), so it shows with the chat's artifacts and, later, in the Artifacts page.
- **Edit** opens the plan artifact for editing. Until the Document editor exists, this is a plain markdown editor in the panel that saves a new version. Approve uses the latest version.
- **Approve** starts a normal run (mode absent) whose prompt carries the approved plan, then turns Plan off. The run's tool calls go through the usual approvals; nothing is auto-approved because a plan was approved.
- **Tests:** server enforcement (writing tools absent, direct calls refused, the bash allowlist including bypass attempts such as `ls; rm -rf`, `$(…)`, pipes, redirects and `&&`), the contract round trip, and an e2e test: Plan on → plan reply plus artifact → Edit → Approve → a normal run that asks before writing.
- Gate and e2e pass.

## Owns

`packages/contract/src/schemas/runs.ts` (`mode` only), `packages/server/src/runs/**`, `packages/ai/src/prompts/fragments/plan.md` and composition, `packages/composer/src/**` (Plan switch), `packages/chat-ui/src/**` (plan card, Edit), `e2e/**`.

## Results (2026-10-02, loop)

Built on `t/106-plan-mode` (worktree `t-106`), not pushed. Commits:
`6e87939` contract (alone), `fecd00d` server, `7641a13` composer + chat,
`e391ee3` e2e, `93a3ff3` approval race fix, then this note. Outside
**Owns**: `packages/i18n/locales/en/messages.po` (the extracted strings,
which the lingui guard requires) and `e2e/support/mock-llm.ts` (the mock
model's plan-mode replies; `e2e/**` is owned).

- **Contract** (own commit): `runModeSchema = z.enum(["plan"])` and
  `mode: runModeSchema.optional()` on `runOptionsSchema`; OpenAPI
  regenerated (two `mode` enums added); old shapes still parse (tests for
  `{}`, 105's shapes, and runs without options).
- **Server enforcement** (`packages/server/src/runs/plan-mode.ts`), applied
  in the executor on every pass, after the memory wrapper adds its tool:
  - kept: `read`, `file_search`, `web_search`, MCP tools whose server marks
    them `readOnlyHint` (and not `destructiveHint`; names must be
    `server__tool`, so a built-in can't claim it), and `bash` wrapped;
  - everything else is left out of the tool set (the model never sees it);
    a direct call to one runs nothing and fails the run, as any unknown
    tool name does today (see open question 2);
  - `bash`: the command is split into words with only plain characters
    and quotes allowed (no `; & | < > ( ) $ \` \\ * ? [ ] { } ! #`, no line
    breaks, no `$`/backtick/backslash inside double quotes, no unclosed
    quote, no leading `~`); the first word must be `ls`, `cat`, `head`,
    `tail`, `wc`, `rg`, `grep`, `find` or `git`; `find` without
    `-exec/-execdir/-ok/-okdir/-delete/-fprint*/-fls`; `rg` without
    `--pre/--pre-glob/--hostname-bin`; `git` only `status|log|diff|show`
    with no global options and no `--ou…`/`--ext…`/`--textc…`, run as
    `git --no-pager --no-optional-locks -c core.fsmonitor=false <sub>
    [--no-ext-diff --no-textconv]`. Bash then gets exactly the checked words
    back, single-quoted where needed. A refusal is a tool error the model
    reads (`{status: "error", message: "Plan mode only runs read-only
    commands … Refused: …"}`).
  - approvals are kept as they were; nothing becomes automatic.
- **Prompt**: `fragments/plan.md` (`planning` part replaces the workspace
  fragment for a planning run; `approved` part carries the approved plan).
  The 079 snapshots are unchanged; two new ones pin the planning prompt.
- **The plan**: on success the answer's text is saved as a markdown
  artifact "Plan: <first # heading, or the request>" and the answer gets a
  `plan` data part; the chat shows it as the plan card (Approve / Edit /
  Discard).
- **Approve** sends a normal run (Plan off for it and after) whose message
  carries a `plan-approval` data part. `createRun` checks it names a
  markdown artifact in the same chat, saves the person's edits (if any) as
  the next version made by that message, and pins the part to the version;
  the turn reads that version into its instructions. Its write asks as
  usual.
- **Edit** opens the plan in the panel as a plain Markdown editor; its
  Approve sends the edited text. There's no separate Save: a person saving
  an artifact version needs a contract route (open question 1).

Verification:
- Tests: `plan-mode.test.ts` (119: allowlist, 80+ bypass attempts, tool
  filtering, MCP annotations, title, approval parsing),
  `plan-mode.runs.test.ts` (11, real runs on PGlite: writing tools never
  offered on any step, direct calls to write/edit/update_memory/
  create_artifact run nothing, `ls; rm -rf /`, `$(…)`, pipes, redirects,
  `&&` refused while `ls -la src` runs as checked, plan artifact saved,
  approval with edits saves v2 and reaches the model, cross-chat and
  oversized approvals refused 422), the contract round trip, two new
  prompt snapshots, composer (Plan switch and chip), chat-ui (card,
  editor, parts, turnOptions).
- `gate.sh`: 85/85 tasks and `evals --strict: ok` on the final commit.
  Two earlier runs under parallel machine load each had one package's
  tests fail (`db`, then `server`); both passed alone and on the rerun.
- `E2E_PORT=3278` e2e (shared queue): 71 passed (70 on main + the new
  `plan-mode.spec.ts`: Plan on → plan reply + card + artifact → Edit →
  Approve → a normal run whose write asks, building the edited plan saved
  as v2).
- Screenshots: `/private/tmp/claude-501/106-screens/` (Plan menu item and
  chip, plan reply with card, Edit view; light/dark; 1280px and 375px).

Open questions for Connor:
1. **Saving an edit without approving** needs a route for a person to save
   an artifact version (`POST /artifacts/{id}/versions`, additive). The
   proposal lists it under the Document editor; it wasn't in this ticket's
   approval, so Edit saves only when you approve.
2. **A call to a tool the run doesn't have fails the run** (the agent
   loop's `onError` treats any tool error as the run's): in plan mode a
   model that calls `write` anyway gets a failed run rather than an error
   it can correct. The evals already list the same bug for bad tool input.
   Fixing it is in `packages/ai/src/agent/run-agent.ts`, outside this
   ticket.
3. **Discard** only sets the plan aside in this visit (no server state).
   Keep, or store it?
4. **Residual risk**: git can run clean filters configured in the
   workspace's own `.git/config` during `status`/`diff`; only an earlier,
   approved run could have written one. Drop `git status|diff` from the
   list, or accept?

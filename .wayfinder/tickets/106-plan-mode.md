---
id: "106"
title: "Plan mode: a read-only planning run, a plan you can edit, then Approve to build"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["105"]
---

## Question

Connor asked for a plan mode, like Claude Code's. It is designed in `docs/proposals/2026-10-01-files-artifacts-plan-mode.md` (PR #76).

His decisions (2026-10-01):
- **Contract:** approved an optional `mode: "plan"` on run options (additive), beside 105's `reasoning` and `fast`.
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

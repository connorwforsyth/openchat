---
id: "073"
title: "Proposal: scoped agent permissions (document only)"
labels: [wayfinder:grilling]
status: open
assignee:
blockedBy: []
---

## Question

**HITL (Connor decides).** Policy-required prompts today: every `write`/`edit` in plain chats asks, and `bash` never
asks even though it can write any file (`docs/audits/2026-09-30/audit-harness.md` §4). This ticket produces a
reviewable proposal only. No code, no policy change, nothing disabled, broadened or auto-approved.

## Done when

`docs/proposals/2026-09-30-agent-permissions.md` exists on the round-2 branch and covers:
- **Current policy:** what asks and what doesn't, and where it's configured (per-chat, per-agent, org policies,
  `app.config.yaml`).
- **Proposed model:** ordered allow/ask/deny rules, last match wins, unmatched asks, deny checked first on the server
  (opencode patterns, cited).
- **Scopes:** tool × path glob × command prefix, per chat, per agent, per org.
- **Grants:** "allow once / for this chat / for this agent / always (org admin)", each with **expiry** (run, chat,
  time-boxed), **revocation** (where the user sees and revokes grants) and an **audit** trail.
- **Risk boundaries:** what can never be auto-granted (for example writes outside `/work`, network egress changes,
  secrets, deleting many files, anything in a shared chat for other participants), and how `bash` fits: command
  prefixes, whether to ask for risky patterns.
- **Worked examples:** the effect on the audit's tasks (a)–(d′), with prompt counts before and after.
- **Migration and UI sketch:** decision options on the card, the grants list in settings.
- **Open questions for Connor.**

## Owns

`docs/proposals/2026-09-30-agent-permissions.md` (on the `round2/audit` branch).

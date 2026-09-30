# Proposal: scoped agent permissions

Ticket 073. **Status: for Connor's review.** This is a proposal only. It
changes no code and no policy, and nothing here is switched on,
widened or auto-approved until Connor signs off. Evidence:
`docs/audits/2026-09-30/audit-harness.md` ("harness audit") and
`docs/audits/2026-09-30/opencode-patterns.md` ("opencode"), plus the code
cited inline.

**TL;DR.**
- Replace today's fixed per-tool flags with ordered allow/ask/deny rules,
  evaluated per call on the server.
- Put a non-grantable safety floor under every rule.
- Add bounded grants (once / run / chat / agent / org) that users can see
  and revoke.
- Ship three presets and make **Balanced** the default. Across the audit's
  six tasks it cuts prompts from 14 to 3, and it starts gating `bash`,
  which today asks for nothing.

---

## 1. Current policy map

| Surface | What asks | What doesn't | Where it's set | Can a user change it? |
|---|---|---|---|---|
| Plain chat | `write`, `edit` (always) | `bash`, `read`, `preview`, attachment tools | `chatSandboxApproval`, `packages/server/src/runs/sandbox.ts:143-151`, called from `chatSandboxTools` (`turn.ts:404-421`) | No: no per-chat, per-user or UI override (harness audit §1.1) |
| Agent | Per-tool `auto`/`ask`; `write`/`edit` are forced to `ask` unless the agent names them | Everything else defaults to `auto` | `agentDefinitionSchema.approvals` (`packages/contract/src/schemas/library.ts:73-81`); `withSandboxTools` (sandbox.ts:121-140); `resolveTools` + `stricter` (`packages/ai/src/tools/resolve.ts:80-98`) | Only by the agent's author, per tool name, for the whole agent |
| Org policy | Nothing about tools | n/a | `orgPolicySchema` / `instancePolicySchema` (`packages/contract/src/schemas/tenancy.ts:152-209`), clamped by `clampOrgPolicy` (`packages/config/src/policy.ts`) | No tool or permission fields exist |
| `app.config.yaml` | Decider thresholds `riskAsk: 0.3`, `riskBlock: 0.7` (`packages/config/src/schema.ts:254-266`); `sandbox.docker.network` (default `true`, :314-315) | n/a | YAML | Admin |
| Decider risk | `riskMode`/`withRisk` exist (`packages/ai/src/decider/risk.ts`) | **Nothing calls them yet** | D15 use 3 (Desktop wave) | n/a |

Gaps that shape the design:
- **`bash` is ungated but can write any file** (`echo > f`), so the
  `write`/`edit` gate is "a review step, not a safety boundary" (harness
  audit §1.1).
- **Path confinement is to `/`, not `/work`.** `resolveSandboxPath` only
  refuses climbing above `/` (`packages/sandbox/src/paths.ts:13-38`), so
  `write /etc/x` resolves. D7 promises "workspace path confinement".
- **Approval is keyed by tool name,** a `Record<tool, status>`
  (`run-agent.ts:138-146`). It can't see paths or commands. ai@7.0.116's
  `toolApproval` also takes a **function** of the tool call that returns
  `{type, reason}` (`ai/dist/index.d.ts:3186-3257`), so per-call rules need
  no SDK work.
- **Any chat editor may decide** another person's approvals (the
  `runs.submitApprovals` description, `packages/contract/src/routes/runs.ts:71-81`).
- **The audit trail today:** each stored tool call has
  `approval: decided{decision, decidedBy, decidedAt}` (`from-ui.ts:77-152`),
  and `decision_log` records Decider calls
  (`packages/db/src/schema/quality.ts:212`).

---

## 2. Proposed rule model

A rule is `{tool, pattern, action: allow | ask | deny}`, as in opencode's
`permission/index.ts`. The **tool** is `write|edit` (file change), `bash`,
`read`, `preview`, `mcp:<server>:<tool>` or `*`. The **pattern** is a path
glob relative to `/work` for file tools, or a command prefix for `bash`.

Evaluation happens **per call, on the server**, inside a
`GenericToolApprovalFunction` built each pass where `chatSandboxApproval` and
`withSandboxTools` are used today (harness audit §4, last bullet):

```
subjects = paths (write/edit) | sub-commands + redirect targets (bash, tree-sitter parse)
for each subject:
  1. FLOOR deny / ORG deny            → denied(reason)      checked first, grants can't override (opencode V2 evaluateInput)
  2. FLOOR ask                        → user-approval, "once" only
  3. action = last match over [preset rules, agent rules]; no match → ask
  4. action == ask && a live grant matches (tool, pattern, grantee, scope) → allow
  5. action == allow && Decider available → stricter(action, riskBand)   (D15: only tightens)
call outcome = strictest over its subjects
```

- **Merge order.** Preset rules come first, then agent rules; the last
  match wins (opencode `agent/agent.ts`). An agent's rules may **tighten**
  anything. They may **loosen** only up to the org's most permissive
  allowed preset, clamped the same way `clampOrgPolicy` clamps other org
  fields.
- **Org rules** do two jobs. They extend the floor (deny/ask), and they
  add org "always" grants (step 4). They never loosen the floor.
- **A fully denied tool** is removed from the model's tool list (opencode
  pattern 4).
- **The `reason`** of the returned status (for example "file last edited
  by you", "matches risky pattern `rm -r`", or "Decider: medium") travels
  on the approval request and is shown as "Why asking" on the card.
- **A deny** returns `denied` with a reason. The model sees it and the run
  continues (opencode: a deny doesn't stop the loop).

---

## 3. Scopes

| Dimension | File tools | `bash` |
|---|---|---|
| Subject | Resolved path under `/work` | Each sub-command from a tree-sitter parse, plus every redirect/`tee` target treated as a **write** of that path |
| Pattern | Glob: `/work/**`, `/work/src/**`, `/work/notes.txt` | Prefix from an arity table: `npm install *`, `git checkout *`, `ls *` (opencode `permission/arity.ts`) |
| Opaque input | n/a | `eval`, `bash -c`, `sh -c`, `$(…)` with side effects, or unparseable → **ask** (no prefix grant offered) |

| Level | Who sets it | Holds |
|---|---|---|
| Chat | Chat owner (or the run creator for their own prompts) | The chat's preset and chat grants |
| Agent | The agent's author (rules); each user (their own agent grants) | `approvals.rules`; per-user time-boxed grants |
| Org | Org admin, within instance limits | Allowed presets, default preset, floor extensions, org "always" grants |

---

## 4. Grants: types, expiry, revocation

| Grant | Offered on the card as | Expires | Grantee | Revoked from |
|---|---|---|---|---|
| Once | "Allow once" | This call | n/a | n/a |
| This run | "Allow for this run" | When the run is terminal (`succeeded`, `failed` or `cancelled`) | Run creator | Chat header popover (live runs) |
| This chat | "Allow `<scope>` in this chat" | When revoked, or when the chat's workspace is destroyed or changes provider | **Run creator only** | Chat header popover; Settings → Permissions |
| This agent | "Allow `<scope>` for `<Agent>`…" (duration picker 1 h / 1 d / **7 d default** / 30 d) | Time-boxed | That user, for that agent, in any chat | Settings → Permissions; Agent page → Permissions |
| Org "always" | Not on the card. Admin console only. | Optional review date | Every member of the org | Admin → Agent permissions |

- **One click covers the batch.** Choosing a run, chat or agent grant
  re-evaluates the run's other pending calls, and those that now match are
  resolved automatically (opencode pattern 6). This fixes the (a′) batch
  step.
- **Revocation takes effect on the next call.** The rules are evaluated
  per call, not frozen per pass. A revoked grant stays in the list, struck
  through, for audit.
- **Replies:**
  - `Reject` sends the rejection and **stops the run** through
    `runs.cancel` (opencode `processor.ts`, plus harness audit F4).
  - `Reject with note…` returns the note to the model, and the run
    continues (opencode `CorrectedError`).
  - Today "Reject all" rejects one call and the agent carries on (harness
    audit §2.2).

---

## 5. Risk boundaries: the floor (every preset, never auto-granted)

| Boundary | Detection | Outcome |
|---|---|---|
| Writes outside `/work` | `write`/`edit` path not under `/work` after `resolveSandboxPath`; bash redirect/`cp`/`mv`/`ln` target outside `/work` | File tools: **deny** (restores D7 confinement). Bash: **ask, once only** |
| Network egress changes | `iptables`, `ip route`, `nft`, edits to `/etc/resolv.conf` or `/etc/hosts`, proxy env exports; any attempt to change runner egress (`none\|allowlist\|open`, `sandbox/src/runner/protocol.ts:29`) | **deny**. Egress is admin config only. *Using* the network under the admin's egress policy follows normal rules. |
| Pipe-to-shell | `curl … \| sh`, `wget … \| bash`, `… \| python` | ask, once only |
| Secrets and env files | `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc`, `**/.ssh/**`, `**/.aws/**`: write, edit, or bash that reads or prints them | ask, once only. In shared chats `read` of these asks too. |
| Mass or irreversible deletes | `rm -r*`, `rm` with a glob, `find … -delete`, `git clean -f*`, `git reset --hard`, `git checkout -- .` | ask, once only |
| Publish or push outside the sandbox | `npm/pnpm/yarn publish`, `cargo publish`, `twine upload`, `git push`, `gh release`, `vercel deploy`… | ask, once only |
| Elevated runtime | `sudo`, `su`, `docker`, `nsenter`, `mount`, `chmod +s`, `setcap` | **deny** |
| Weak isolation | Runner reports `runtime: runc` or an isolation `warning` (protocol.ts:27-35) | Builder falls back to Balanced for `bash` (unmatched commands ask); banner in the chat header |
| Other participants (shared chats) | The run's creator is not the grantee; a file last written by a different participant | Grants apply only to runs the grantee started. Another editor may answer **once** but can't create grants. Overwriting another participant's file asks the run creator. |
| Doom loop | 3 identical calls in a row (opencode `processor.ts` L29) | ask, once only |

**How `bash` is treated.**
- It moves from never asking to being governed like everything else. Each
  sub-command is matched by prefix.
- Presets carry a **known-prefix allowlist**:
  - read-only: `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `jq`,
    `diff`, `tree`, `pwd`, and `find` without `-delete`/`-exec`;
  - build and test: `npm|pnpm|bun|yarn install|ci|test|run *`, `node *`,
    `python *`, `pytest *`, `tsc *`;
  - in-`/work` file ops: `mkdir`, `touch`, `cp`, `mv`, checked by path.
- The floor list above always asks or denies.
- **Why the allowlist is safe.** Execution is already isolated: just-bash
  spawns no processes and has no network (`just-bash/provider.ts:35`), and
  Docker runs under gVisor with no host mounts (D7). The rules therefore
  protect three things the sandbox doesn't:
  - the user's files, covered by path rules and undo;
  - effects outside the sandbox, covered by egress and publish rules;
  - secrets.

**The Decider.**
- It applies only at step 5, to calls that rules or grants already
  allowed. It never unblocks anything (D15 invariant; `stricter` in
  resolve.ts:23).
- Bands use the existing thresholds. A low score runs; a score of 0.3 or
  more asks; a score of 0.7 or more is high.
- **Recommendation:** in web sandboxes, "high" becomes an ask that can
  only be answered once, not a deny. The sandbox isolates, and a false
  positive shouldn't wall off a command permanently. Desktop cowork keeps
  D7's "high blocks".
- With no Decider reachable, unmatched commands ask (D7: "`auto` means
  allowlist-only").
- Risk scores go to `decision_log` (purpose `risk-score` already exists,
  `contract/src/schemas/decider.ts:99-108`).

**Auto modes can't bypass the floor.** Presets are server-side rule sets,
unlike opencode's client-side auto mode that replies `once`. No client
setting reaches steps 1–2.

---

## 6. Presets

| | Conservative | **Balanced (proposed default)** | Builder ("make little projects") |
|---|---|---|---|
| New file in `/work` | ask | allow | allow |
| Change a file the agent created in this chat | ask | allow | allow |
| Change a file a person last wrote (upload, Files panel, another participant) | ask | ask (harness audit §4: "keep asking") | allow, with Undo on the FileChangeCard |
| `bash`, known prefix | read-only prefixes allow; others ask | allow | allow |
| `bash`, unmatched prefix | ask | ask, offering "allow `<prefix> *`" | Decider low → allow; otherwise ask (no Decider → ask) |
| Grants offered | once, run | once, run, chat, agent | once, run, chat, agent |
| Floor | yes | yes | yes |

Conservative is the org-enforceable "review everything" setting. Builder
is opt-in per chat, and only if the org allows it. Relative to today,
Balanced is **looser** for agent-authored files and **stricter** for
`bash`.

---

## 7. Worked examples (audit tasks, harness audit §2 and §4)

Each count is the number of policy-required prompts. It assumes the user
picks the widest grant the card offers; the figure in brackets is for a
user who only ever clicks "Allow once". The tasks run on just-bash, so
(c)'s `npm` steps would fail fast; the counts are the same on Docker.

| Task | Today | Conservative | **Balanced** | Builder |
|---|---|---|---|---|
| (a) 3 new files, sequential, then `preview` | 3 | 1 (3), "for this run" | **0** | 0 |
| (a′) same, one parallel step | 3 (18 card mounts, F3) | 1 (3); the run grant clears the siblings | **0** | 0 |
| (b) `edit` ×2 on a seeded (person-written) `notes.txt` | 2 | 1 (2) | **1 (2)**: "allow edits to `notes.txt` in this chat" | 0 (Undo shown) |
| (c) write `package.json`, `npm install`, 2 sources, `npm test` | 3 (bash unasked) | 3 (5): file run grant, `npm install *`, `npm test *` | **0** (all known prefixes) | 0 |
| (d) re-read and rewrite the user-edited `doc.txt` | 1 | 1 | **1** (kept on purpose) | 0 (Undo shown) |
| (d′) the user edits the file while the write waits | 2 (1 wasted) | 1* (2) | **1*** | 0: no wait; the hash guard refuses a racing write and the model re-reads |
| **Total** | **14** | **8 (16)** | **3 (4)** | **0** |

\* This needs harness audit F12, which re-proposes the change when the
Files panel saves. Without it, add 1.

- Balanced's three prompts are all the audit's "person wrote this" case.
- Conservative costs more than today on (c) because it closes the `bash`
  hole.
- Totals include (a′). Excluding it: today 11, Balanced 3.

---

## 8. Card UX sketch

```
┌─ Edit notes.txt ────────────────────────────── +3 −1  [diff ▾] ─┐
│ Why asking: you last edited this file (Files panel, 2 min ago)   │
│                                                                  │
│ [ Allow once ]  [ Allow… ▾ ]            [ Reject… ▾ ] [ Stop ]   │
│                   ├ for this run                                  │
│                   ├ edits to notes.txt in this chat               │
│                   └ all file changes in /work in this chat        │
└──────────────────────────────────────────────────────────────────┘
```

- **Bash cards** propose the parsed prefix: `[ Allow once ] [ Allow "npm
  install *" in this chat ▾ ]`.
- **Floor cards** show only `Allow once` and a lock line, for example
  "Deletes many files. This can't be pre-approved."
- **Choosing "in this chat"** opens a one-line confirm (no second modal).
  For example: *"The agent can change files matching `/work/**` without
  asking, in this chat, for your prompts only. Floor checks still ask.
  Revoke from the shield menu."*
- **Reject** has two options: **Reject and stop** (the default) and
  **Reject with a note…** (the run continues).
- **Auto-applied changes** keep their FileChangeCard. It adds the line
  "Allowed by: file changes in /work (this chat) · Revoke · Undo".

## 9. Settings and admin sketch

- **Chat header: a shield chip,** for example "Balanced · 2 grants". It
  opens a popover with the preset picker (limited to what the org allows)
  and the chat's grants, each with Revoke. In shared chats it shows
  everyone's grants, labelled by owner.
  - This is kept out of the Share popover on purpose: Share controls
    access (`resource_grant`, D25), which is a different question.
- **Settings → Permissions** has three parts:
  - "Default preset for new chats";
  - a table of my grants (scope, tool, pattern, where, expires, last used,
    Revoke);
  - a filter by chat or agent.
- **Agent builder → Permissions tab:**
  - the author edits the rules table (tool / pattern / action, with drag
    to reorder and a "last match wins" hint);
  - the side test chat shows "Why asking" live.
- **Admin → Org policy → Agent permissions:**
  - the allowed presets and the default;
  - floor extensions (extra deny/ask patterns);
  - org "always" grants;
  - a searchable `permission_event` log.

---

## 10. Audit trail

| What | Where |
|---|---|
| Every evaluated call: tool, subject (path or command), outcome, **the source that decided** (floor / org / preset / agent rule / grant id / Decider / user), reason | New `permission_event` rows (run, conversation, toolCallId, actor) |
| The user's answer | Existing `approval: decided{…}` on the message part, plus `permission_event` |
| Auto-allowed calls | Message part `approval: granted{source}` (new state), so reloads show "Allowed by…" |
| Grant lifecycle (create, use, revoke, expire) | `permission_grant` columns, plus `permission_event` |
| Risk scores | `decision_log`, purpose `risk-score` |
| Pre-image for Undo (Builder, person-written files) | Per-change pre-image, or `Sandbox.snapshot` per run (`sandbox/src/ports/sandbox.ts:72`) |

---

## 11. Data model sketch

**New tables**, in `packages/db/src/schema/access.ts`:
- `permission_grant(id, scope run|conversation|agent|org, scopeId,
  granteeUserId null=org, tool, pattern, createdBy, createdAt, expiresAt
  null, sourceRunId, sourceToolCallId, lastUsedAt, revokedAt, revokedBy)`.
  This is deliberately separate from D13's `resource_grant`, which answers
  *who may access* a resource, not *what an agent may do*.
- `permission_event(id, runId, conversationId, toolCallId, tool, subject,
  outcome allow|ask|deny, source, sourceRef, reason, actorId, createdAt)`.
- `conversation.permissionPreset` (nullable, meaning the org default).

**Contract changes. Each needs Connor's approval:**

| Change | File |
|---|---|
| `toolApprovalModeSchema` gains `deny`, and `approvals` gains `rules: [{tool, pattern, action}]`. Existing `default`/`tools` are kept and read as rules. | `contract/src/schemas/library.ts:73-81` |
| `approvalDecisionSchema.approve` gains an optional `grant: {scope: run\|chat\|agent, pattern, expiresIn?}`; `reject` gains `stop: boolean` | `contract/src/schemas/message-parts.ts:108-120` |
| The stored `approval` union gains `granted{source, sourceRef}` | `message-parts.ts` / `ai/src/messages/from-ui.ts` |
| `orgPolicySchema.agentPermissions {defaultPreset, allowedPresets, floorExtensions}`, plus an instance limit in `instancePolicySchema` (`policies.agentPermissions` in `app.config.yaml`) | `contract/src/schemas/tenancy.ts` |
| New routes `permissions.list`, `permissions.revoke`, `permissions.events`, and `conversations.setPermissionPreset` | `contract/src/routes/` |
| `submitApprovals` rejects already-decided calls, and only the run creator may attach a grant | `routes/runs.ts:71-81` (also harness audit F3/F8) |

---

## 12. Rollout and migration

0. **Prerequisite: ticket 072 (harness audit F1–F4, F12).** Hidden,
   flashing and un-stoppable cards would make any ask look broken.
1. **Shadow.** The evaluator runs beside today's policy and writes
   `permission_event` with `would_*` outcomes. There is no behaviour
   change. The e2e audit harness then re-measures §7.
2. **Floor and path confinement.** This tightens only: file-tool deny
   outside `/work`, and the bash floor asks. It is behind a flag.
3. **Grants.** Once, run and chat grants; the card options; the chat
   header popover; Settings → Permissions.
4. **Presets.** Balanced becomes the default for **new** chats. Existing
   chats map to Conservative plus a one-time banner: "Try Balanced".
   Builder is opt-in.
5. **Agents and orgs.**
   - Migrate `approvals`: `default` becomes rule `* <mode>` and each tool
     entry becomes a rule. Keep `withSandboxTools`'s write/edit `ask` as
     an agent rule unless the author set it.
   - Then the org policy fields and the admin UI.
6. **Decider risk bands** for bash (D15 use 3), after the Desktop-wave
   Decider work. Until then, Builder behaves as allowlist-only for
   unmatched commands.

## 13. Non-goals

- Code or policy changes in this ticket.
- Desktop cowork permission modes (D7). They should reuse this engine
  later.
- MCP server grants (ticket 018). MCP tools get tool-level rules only.
- Changing per-hunk review, or the egress settings themselves.
- Fixing F1–F12 (ticket 072).
- A client-side "yes to everything" mode.

## 14. Open questions for Connor

1. **Default preset:** Balanced (recommended) or Conservative for new
   plain chats?
2. **Tightening `bash`:** Balanced makes unknown bash prefixes and floor
   patterns ask where today nothing does. Is that acceptable?
3. **Decider "high" in web sandboxes:** a once-only ask (recommended) or a
   deny, as D7/D15 read today?
4. **Plain Reject stops the run** (recommended, as in opencode), with
   "Reject with a note" to continue. OK to change today's semantics?
5. **Shared chats:** should a co-editor's answer be limited to "once" on
   someone else's run (recommended), even though the contract says "any
   editor may decide"?
6. **Chat grant expiry:** none until revoked (recommended), or a 30-day
   idle expiry?
7. **Builder's Undo:** per-change pre-images or a per-run
   `Sandbox.snapshot`? Should Builder wait for Undo before shipping?
8. **Approval of the contract changes** in §11, and a separate
   `permission_grant` table rather than extending `resource_grant`.
9. **Preset per provider:** should just-bash (no processes, no network)
   default to Builder, while Docker defaults to Balanced?

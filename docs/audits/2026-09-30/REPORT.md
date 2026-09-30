# Round 2 report: harness reliability and workspace UX (2026-09-30)

This round went up as draft PRs for review. **Update (2026-09-30):** Connor decided three of them and they are merged: #60, #63 (keeping cancel-on-send) and #65 (dev-only relaxation; the worker thread is ticket 083). The rest (#61, #62, #64, #66, #67) are still drafts. Nothing is deployed. Policy changes are a proposal only.

## Evidence
- **Harness audit:** [`audit-harness.md`](audit-harness.md). It traces the flow with file:line references, maps the run and tool-call state machine, and measures prompts with the mock model.
- **UI audit:** [`audit-ui.md`](audit-ui.md). It counts borders and nesting, measures the sidebar, finds keyboard and focus gaps, and has 96 before-screenshots (kept outside git).
- **Research:**
  - [`opencode-patterns.md`](opencode-patterns.md): permissions, run states, cancellation and reconnection, with cited source.
  - [`zettelkasten-behaviours.md`](zettelkasten-behaviours.md): Connor's own navigation, panel, search, resize, focus and motion patterns, with file:line references.
- **Screenshots:** a curated before/after set in [`screens/`](screens/).

## Approval prompts, before → after (PR #63)

| task | prompts | accidental dup/stale | policy-required | hidden until reload | reloads |
|---|---|---|---|---|---|
| (a) 3 files, one per step | 3 → 3 | 0 → 0 | 3 → 3 | 2 → **0** | 3 → **0** |
| (a′) 3 files in one step | 18 card mounts → **3** | 15 re-mounts + 5 dup POSTs → **0** | 3 → 3 | 0 → 0 | 0 → 0 |
| (b) edit twice | 2 → 2 | 0 → 0 | 2 → 2 | 1 → **0** | 1 → **0** |
| (c) scaffold | 3 → 3 | 0 → 0 | 3 → 3 | 2 → **0** | 4 → **0** |
| (d) re-read and rewrite | 1 → 1 | 0 → 0 | 1 → 1 | 0 → 0 | 0 → 0 |
| (d′) user edits while pending | 2–3 → 2 | 1 wasted stale approval → **0** | 2 → 2 | 1 → **0** | 2 → **0** |

**Policy-required prompts** didn't change (14 in total), by design. The permissions proposal would take them to **3** under its recommended Balanced preset. The 3 left are all "the agent wants to change a file a person wrote".

## PRs (all drafts)

| PR | Ticket | What | Checks |
|---|---|---|---|
| #61 | — | Research, audits, tickets 070–077, permissions proposal, screenshots | docs only |
| #60 | 074 | The agent's `read`/`write`/`edit` stay inside `/work`, as PLAN D7 promises | 24 new refusal tests; gate 82/82 |
| #62 | 071 | Sidebar: 36px rows, fading titles, quiet actions, drag resize on both edges (200–420px, keyboard, reset, saved and restored with no jump), edge peek, rename bug fixed | e2e 39/39; gate 82/82 |
| #63 | 072 | Harness: live cards, idempotent decisions (409 on flips, atomic writes), a Stop that cancels (kills bash, keeps partial output), honest states, stale-file card, 6 more bugs found while measuring | 10 new e2e; e2e 43/43; gate 82/82 |
| #64 | 070 | Workspace: at most 1 border between panel edge and content in file and preview views, 48px header rows, flush tree, "/" file search, toolbar fits at 340px, narrow list/view turns, focus in/out and Escape, the `d` theme-key bug fixed | e2e 37/37; gate 82/82 |
| #66 | 077 (on #64) | Flush pending edits on pagehide (keepalive); "Unsaved" and slow-only "Saving…"; only failures speak | reload-after-typing 5/5; gate 82/82 |
| #67 | 075 (on #64) | Flat artifact view (174px → 48px of chrome); search rows middle-truncate and show the folder, with highlights | e2e 37/37; gate 82/82 |
| #65 | 076 | `next dev` no longer crashes when just-bash runs. **Needs Connor's decision:** it turns off one just-bash layer in dev only; the alternative is a worker thread | dev check 12/12; prod e2e 34/34 |

The requested e2e coverage is spread across the PRs:
- create, edit and preview: #63, #64
- file search → open → preview/code → back: #64
- sidebar resize, collapse and reload: #62
- rapid approval clicks, denial, cancellation, reconnect and two tabs: #63
- edit then immediate reload: #66

## Decisions for Connor
1. **Permissions:** the proposal (`docs/proposals/2026-09-30-agent-permissions.md`) has 9 open questions: the default preset, tighter `bash`, whether Reject stops the run, the contract changes, and more.
2. ~~**#63:** a new message sent while a change waits now cancels that answer, as Stop would, instead of queuing forever. OK?~~ Decided: yes, merged.
3. ~~**#65:** accept the dev-only relaxation, or do the worker-thread isolation?~~ Decided: dev-only now (merged), worker thread later (ticket 083).
4. **"[" key:** should it toggle the sidebar, as in the Zettelkasten? It's "previous branch" today, which would move to Shift+[ / Shift+].

## Follow-ups found (not started)
- `DiffView` `header={false}`, so the artifact Changes tab loses its second strip (#67).
- A `--highlight` token for search hits (#67).
- "Stopped by you" should name the person in shared chats (#63).
- A symlink inside `/work` that points outside is still followed, and `@file` reads use the loose path resolver (#60).
- Running just-bash in a worker thread (#65).

# Approval harness: after the fixes (072)

The audit (`docs/audits/2026-09-30/audit-harness.md`, branch
`t/audit-harness`) measured the approval harness on a production build with
the mock model and a just-bash workspace. This is the same measurement on
`t/072-harness-reliability`, with the audit's own harness
(`zz-audit-harness.spec.ts`, not committed; a "patient person" who clicks the
first visible Approve after 250 ms and reloads when nothing changes for 15 s),
adapted in two places:

- (d') the person edits the file **in the Files panel**, as a person would
  (the audit wrote it through the API, which no open page sees), and when a
  card says the file changed they press "Ask for an updated change";
- a click gives up after 5 s instead of hanging on a card that went inert.

`E2E_PORT=3553`, under `scripts/ci/browser-lock.ts`, 2026-09-30. The
measurement also found three things, fixed before these numbers were
final: a reopened page flashed its card away while the stream replayed, the
composer waited for the runs list to agree before offering Send, and the
waiting note outlived a stop.

## Approval counts

"Card mounts" counts every approval card element that appears. "Duplicate /
stale" is mounts beyond one per call plus decisions posted again for a call
already decided, plus prompts for a diff that could no longer apply.
"Hidden" is a policy-required prompt that never appeared live. Before is the
audit's table (§2.1).

| task | total prompts (card mounts) before → after | accidental duplicates / stale before → after | policy-required (server) before → after | hidden until reload before → after | reloads needed before → after | POSTs (dup) before → after | wall time before → after | stream subscriptions before → after |
|---|---|---|---|---|---|---|---|---|
| (a) 3-file site, sequential | 3 → **3** | 0 → **0** | 3 → **3** | **2** → **0** | 3 → **0** | 3 (0) → 3 (0) | 48.0 s → 1.6 s | 4 → 1 |
| (a') 3-file site, one step | **18** → **3** | **15 re-mounts, 5 dup decisions** → **0** | 3 → **3** | 0 → 0 | 0 → 0 | 8 (**5**) → 3 (0) | 6.5 s → 1.7 s | 7 → 1 |
| (b) edit twice | 2 → **2** | 0 → **0** | 2 → **2** | **1** → **0** | 1 → **0** | 2 (0) → 2 (0) | 16.7 s → 1.2 s | 3 → 1 |
| (c) scaffold | 3 → **3** | 0 → **0** | 3 → **3** | **2** → **0** | 4 → **0** | 3 (0) → 3 (0) | 63.6 s → 1.6 s | 4 → 1 |
| (d) re-read + rewrite | 1 → **1** | 0 → **0** | 1 → **1** | 0 → 0 | 0 → 0 | 1 (0) → 1 (0) | 0.8 s → 0.9 s | 2 → 1 |
| (d') user edits while pending | 2–3 → **2 prompts** (3 mounts, see below) | 0–1, plus **1 wasted approval** of a diff that couldn't apply → **0** | 2 → **2** | **1** → **0** | 2 → **0** | 2 (0) → 2 (0) | 32.3 s → 10.2 s | 3 → 1 |

Separating the two kinds of prompt, as the ticket asks:

- **Policy-required prompts are unchanged**: one per `write`/`edit`, 3 / 3 / 2
  / 3 / 1 / 2. Nothing was auto-approved, no tool stopped asking, and access
  is the same (see "Authorization").
- **Accidental duplicates, stale or hidden prompts went to 0** in every task:
  no card re-mounts with its buttons back, no decision is posted twice, no
  card waits behind a reload, and no reload is needed at all.
- (d') still shows two policy-required prompts, because the agent has to ask
  again for a change on a file the person edited: the first card now says
  "doc.txt changed after the agent proposed this" (its third "mount" is that
  same card redrawn in its stale form, not a new prompt) and offers "Ask for
  an updated change" instead of Approve. So no approval is spent on a diff
  that can't apply, and the second card shows the diff against the file as
  it is.

## Probes

| probe | before (audit §2.2) | after |
|---|---|---|
| rapid double-click Approve | 1 POST, run succeeded | 1 POST, 1 card mount, run succeeded |
| Approve, then reload at once | decision kept; card flashed back once | decision kept, 1 card mount, 0 cards after the reload, run succeeded |
| Reject all | 1 reject; the next card hidden ("Thinking…") | 3 rejects (each next card appeared live), 3 denied results, agent finished ("Script site done") |
| Stop during a pending approval | run still `awaiting_approval`; card still there after reload | run `cancelled`; 0 cards, also after reload; the call reads "Stopped by you" |
| Stop during a running `sleep 20` | run stayed `running` and succeeded | run `cancelled` at once; the bash result is "Stopped by the user before it finished." with its partial output (`bash: execution aborted`) |
| close the tab mid-run, reopen | next card hidden until a reload | the reopened tab followed the run: 2 cards, 2 mounts, 0 reloads, 1 stream subscription, done |
| two tabs, same approval | tab B's 409 swallowed; B stuck on "Thinking…" | both 200 (the same decision twice is a no-op); both tabs show the next card live |
| two tabs, different calls of one step | both kept | both 200, both kept, 3 mounts per tab for 3 cards |
| re-decide a decided call (approve → reject) | 200, stored decision flipped | **409 CONFLICT**; the approval stands |
| concurrent API decisions on different calls (5×) | 5/5 kept (PGlite) | 5/5 kept, now inside one locked transaction |
| new message while an approval waits | Send unavailable; after reload the new run queued behind the waiting one indefinitely | Send offered while the card waits; after a reload the new message cancels the waiting run (its change never applied) and its own run succeeds; 0 cards left. The measurement found the waiting note lingering after this (a stopped run's leftovers still counted as waiting); fixed, and `harness.spec.ts` checks it goes |

## What changed, briefly

- Cards appear live after every decision: `liveParts` maps decisions from
  the stored answer and the stream, and drops only a part it can't map; the
  server streams a `tool-approval-response` for each decision.
- A decision is sent once and stays made: blocks keyed by `toolCallId`, the
  sent state held by call until the server shows it, the card inert while it
  travels, and the server answers a repeat with 200 and a flip with 409, in a
  locked transaction.
- A page following the run's stream doesn't reopen it after a decision (one
  subscription per task, down from 3–7).
- Stop cancels the run on the server; pending calls resolve as not run and
  running tools are killed, announced on the stream so every tab drops the
  card.
- A reload revalidates the persisted conversation, and a page opened during
  a pause follows the run.

## Authorization

No policy change: `chatSandboxApproval`, `withSandboxTools` and the agent
approval modes are untouched, so the same tools ask. No new auto-approval:
the client never decides on its own, and "Ask for an updated change" is a
reject. No broader access: Stop and "a new message moves on"
cancel a run, which anyone who may send in the chat could already do.

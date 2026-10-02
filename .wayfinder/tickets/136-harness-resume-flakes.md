---
id: "136"
title: "Harness e2e flakes under load: a second tab keeps its card after Stop; a card stays after approving across a reload"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: []
---

## Question

Found while fixing 133. Two `e2e/tests/harness.spec.ts` tests fail intermittently under load, at the same rate with and without 133's fix:
- "Stop while a change waits…": the second tab keeps its approval card (around line 279).
- "a reload mid-run or during a pause…": the `script.js` card stays after approving.

These look like stream/resume state problems in chat-ui (`packages/chat-ui/src/chat/connected-chat.tsx`): a card isn't cleared when another tab or a resume settles it. They may be real UI bugs on slow connections.

## Done when

- Root cause found by reproducing with delayed SSE or resume responses.
- A fix plus a regression test. `harness.spec.ts` passes 20/20 with `--workers=4` under load.

## Results (2026-10-02, loop)

Branch `t/136-harness-flakes` (not pushed). chat-ui and e2e only; no contract,
port or server changes. Three client races, each reproduced deterministically
with held or slowed requests, each failing before its fix.

**1. Second tab keeps its card after Stop** (`connected-chat.tsx`). A tab
opened on a waiting chat shows the stored card, then asks for the active run
(`runs.list limit=1`, in `reconnectToStream`) to follow its stream. Trace of a
baseline failure: tab 2's lookup went out at 23.969, tab 1's cancel at 24.061,
and tab 2 never opened a stream: the run had ended, the lookup returned
nothing, and nothing else re-reads the chat (no stream means no `onFinish`), so
the card stayed. Fix: following a run re-reads the stored branch however it
ends, including when there was nothing to follow.

**2. A decision dropped during a replay** (`model/live-messages.ts`,
`model/run-activity.ts`, `useDecisions`). A reloaded page replays the run's
stream from 0. `mergeLive` showed the live copy once it had every stored call
by id, even when a call had only its input so far (maps as `not-required`,
no card). The call stopped looking like it waited, `useDecisions` dropped the
"sending" state, and when the approval request replayed the card came back
undecided; the next click decided style.css again (traces: two clicks resolve
to the same card, the second polls `awaitingRunFor` for 5 s), so script.js was
never approved. Fix: `caughtUp` compares per-call progress (asked < decided <
answered), and a sent decision is kept until its call is decided or answered
on screen (`unsettledCalls`), not merely until it stops looking pending.

**3. A card restored from the last visit is clickable** (`connected-chat.tsx`,
`approval.tsx`, `approval-state.tsx`, `tool-part.tsx`). Found in the load run
after fix 2: the persisted query cache (D28, written about a second behind)
restored the branch with index.html still pending, rendered before the
refetch landed; the screencast shows the click on that card, which the server
had already decided. Fix: a stored branch from before the chat was shown that
is stale and not refetched since (`restoredUnchecked`) marks cards as
checking: inert, `aria-busy`, "Checking this change still waits…", until the
refetch lands or fails. Fresh or non-stale data is unaffected.

**Tests.** Unit: `caughtUp` and `mergeLive` during a replay, `unsettledCalls`,
`restoredUnchecked`, an ApprovalCard "checking" test (chat-ui 138 tests in the
touched files pass). e2e in `harness.spec.ts`: "a second tab still looking for
the stream when Stop lands…" (holds tab 2's run lookup), "a decision sent while
a reloaded page replays the run stays sent" (100 ms per stream event, decision
POST held), "a card restored from the last visit waits until it's checked"
(branch refetch held across the reload). Each failed without its fix.

**Numbers** (`harness.spec.ts --repeat-each=20 --workers=4`, 4 CPU burners,
machine load average 60–115 from other worktrees):
- origin/main: Stop test 5/20 failed (line 279); 25 did not run.
- fix 1: Stop tests 40/40; reload test 3/20 failed (race 2).
- fix 1+2: reload test 2/20 failed (race 3); 9 more timed out in `goto` or
  composer-ready at load average ~110.
- fix 1+2+3: **260/260 passed** (13 tests × 20).
- Two test-only fixes after that, both in the new restored-card test: its
  IndexedDB probe now creates idb-keyval's store if it opens the database
  first (otherwise the app could never persist; seen once in the full
  suite), and it no longer waits for the composer while the branch request
  is held (that batch can carry what the composer needs).
- Rebased on origin/main (#106–#108), the same load run again: **260/260**.
- `gate.sh`: check, guards, turbo 93/93, evals green. Full e2e
  (`.tools/e2e.sh 3308`): 99/99.
- One run at load average ~100 (before the restart) had timeouts where the
  server took 5–12 s per request, plus one approval POST that never got an
  answer; nothing pointed at the client.

**Open.**
- `run-transport`'s `current` map is never cleared, so `reconnectToStream`
  replays the last run this page followed even after it finished; a run
  started elsewhere afterwards wouldn't be followed by a resume. Not seen in
  these tests; worth a small ticket.
- A restored branch still reads "This answer stopped early" until the refetch
  lands (cosmetic, same cause as 3).
- The checking gate also holds cards that arrive on the live stream until the
  branch refetch lands; conservative, usually well under a second.
- `awaitingRunFor` polls ~5 s before failing a decision for a call that is
  already decided; it could check the branch instead.

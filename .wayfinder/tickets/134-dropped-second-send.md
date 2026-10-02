---
id: "134"
title: "A second message sent ~0.4s after the first on a new agent chat never reaches the server"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Found while fixing 132. `skills.spec` "an agent lists its skill and loads it with load_skill" failed once: on a new `/?agent=` chat, the second message (sent about 0.4s after the first) never produced a run request; the trace shows none. It passed 5/5 on rerun. This is probably a real client bug: a send during the new chat's creation and navigation is dropped, not queued.

## Done when

- Reproduce with a delayed `POST /conversations` / run response. A send during new-chat creation is queued or blocked visibly, never silently dropped.
- Regression e2e.

## Results (2026-10-02, loop)

**Two things were tangled together here.** One was a real bug: a send during new-chat creation was silently dropped. The other caused the `skills.spec` one-off: the test pressed Enter while the composer was still busy.

**1. A send while a new chat was created dropped the first message (fixed).**

- Probe: `page.route` held `POST /api/conversations`, or the router's fetch of `/c/<id>`. A second message was sent during the hold.
- Before the fix, in both windows, the second send found no conversation id yet. It created a second chat (two `POST /api/conversations`).
- `useFirstSend` kept a single `pending` slot, so the second send overwrote the first. The page ended up in chat 2 with only "two".
- "one" was never sent. Its chat was left empty in the sidebar.

**2. The `skills.spec` flake was a send while the previous reply was still ending.**

- The trace had no second `POST /api/runs` and no `POST /api/conversations`. Bug 1 would have shown a second create, so it wasn't bug 1.
- A probe of the same test ran 10 times. The reply's text was on screen while the composer still showed Stop in 9 of 10 runs. It stayed busy for another 100–250 ms with no extra load.
- `send()` typed the 45-character message (about 0.4 s) and pressed Enter. When the tail outlasted the typing, the composer was still busy. Enter does nothing while busy, by design: "Enter … must never stop a run" and `canSubmit` is false.
- The text stayed in the composer and no request went out. A held run or stream confirmed it: the text stays and nothing is sent.
- So nothing was lost there. The test raced the composer.

**Fix.**

- `packages/chat-ui/src/model/first-send.ts` holds the pure part: a first-send queue (`firstSendStarted/Queued/Failed/Next/Busy`), unit-tested in `first-send.test.ts`.
- `useFirstSend` in `connected-chat.tsx` now works like this:
  - One creation per first send. A racing send reuses it.
  - Messages get ready in send order, so uploads can't reorder them.
  - They go one at a time once the page is at the chat's address. Each waits for the previous answer, via `sendMessage`'s promise.
  - On a failure the next try starts afresh. Messages already waiting still go.
- The composer is busy from a new chat's first send until it has gone. It shows `submitted`, the same as once a run starts. A typed second message stays in the composer with Stop showing, like any send while a run streams. This is the "blocked visibly" option, and it matches how the composer already treats a send while an answer streams.
- Stop is disabled in that window, since there's no run yet. Before, it would have tried `createdRunId`, which can belong to an earlier chat.
- Sends that bypass the composer, such as Ask AI or the preview command, queue into the same chat instead of making another.
- The e2e `send()` helper now waits for an enabled Send button before Enter, as a person waits for Stop to turn back into Send. This fixes the `skills.spec` race and the same latent race in every send → expectReply → send spec.

**Regression e2e.** `chat.spec.ts` "a message sent while a new chat is being made waits in the composer; the first still goes (134)".

- It holds the create, then the navigation. It presses Enter during each hold and checks that Stop shows and the text stays.
- After release, the first is answered, the second is sent from the composer, both are in one chat, and there is exactly one `POST /api/conversations`.
- Before the fix it failed at once: the composer was not busy because the second message had been sent. After the fix it passed 5/5.

**Numbers.**

- `e2e.sh 3302 tests/skills.spec.ts tests/chat.spec.ts --repeat-each=20 --workers=4`: 118 passed, 40 failed. All 40 are strict-mode violations from repeating fixed data in one shared database:
  - 17× chat "Topic Hello zebracorn alpha" title;
  - 20× ⌘K search;
  - 3× skills "E2E Haiku" menu item.
  None involves sending. These tests aren't repeat-safe; that isn't a regression.
- The same command with those three left out (`-g "load_skill|134|centred|mid-reply|branch"`) and 6 CPU burners: **101/101**. That includes `load_skill` 20/20 and the new 134 test 20/20.

**Open.**

- Enter while busy gives no feedback beyond the visible Stop. Queuing typed sends during a stream would be a product change: a queued-message UI, plus a client-side queue, because AI SDK `sendMessage` isn't safe to call concurrently.
- If the person moves to another chat in the few milliseconds between a first send's create and its navigation, that queued message isn't sent. This was already the case.
- When 103 (server-seeded chat) lands it will replace this flow. Keep the "one chat per first send; busy until sent" behaviour and the 134 e2e.
- The 100–250 ms between a reply's text and its stream closing is on the server. It is harmless but noticeable.

**Verification.**

- Rebased on origin/main, which includes 132 (#101). The rebase was clean.
- `bun run check` and `bun run check:guards` exit 0.
- `gate.sh`: 93/93 turbo tasks. `evals --strict` failed once inside the gate, then passed twice on its own (exit 0). Nothing here touches the evals.
- Full e2e via `.tools/e2e.sh 3302`: 92/92.

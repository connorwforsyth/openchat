---
id: "132"
title: "Flaky e2e: composer.spec 'the thinking level and fast mode sit apart' (105)"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

`e2e/tests/composer.spec.ts:188` fails intermittently under load. It failed on 116's agent run, once on 129 and once on 106, and passed on reruns (129: three full runs, 74/74 each). The failures are `toHaveAccessibleName` on the Thinking button and `toBeVisible` on the Fast mode chip. A likely cause is a race where the new chat's details or the model list settle after the user picks a level or model, and reset it. That would be a real UI bug (cf. 111), not just a slow test.

## Done when

- Root cause found by instrumenting the failing run (trace on failure). Fix the app if it's a reset race; otherwise fix the test's waits.
- The spec passes in 20 repeats under parallel load (`--repeat-each`).

## Also (2026-10-02)

`@workspace/chat-ui#test` failed in the gate under heavy load on 106 (3 runs) and on 124 (once), then passed alone and on clean runs (395/395). Find which test it is when fixing this one.

## Results (2026-10-02, loop)

**Root cause: a reset race in the app, not a slow test.** In an open chat the
shown and sent target was `conversation.defaultTarget ?? chat.target ?? …`, so
the chat's details (`GET /api/conversations/:id`) beat a pick. They can land
after the pick and still name the old model in two ways. The chat may not have
loaded when the person picked. Or a read may have started before the pick's
`PATCH`. After a first turn the title watch re-reads the chat every second, and
the turn's refresh and the previous pick's `onSettled` re-read it too. The
optimistic `setQueryData` also did nothing while the chat hadn't loaded. Then:

- The picker flipped back to the old model for a moment, or for good when the
  chat hadn't loaded.
- `useModelVariants` put the old model's remembered level into the variant.
  When the target came back, GPT-5.2 showed "Thinking: Low" instead of "Off".
  This is the `toHaveAccessibleName` failure.
- Fast mode was dropped or carried over. These are the fast-chip
  `toBeVisible`/`toBeHidden` failures.
- A message sent during the window went out with the old model. This is the
  `mock:echo` run.

**Fix** (`apps/web/app/(app)/(chat)/chat-route.tsx`, `message-target.ts`):

- `useTargetChange` keeps `pickedHere`, the last pick in the open chat, keyed
  by conversation id. Both the shown target (`shownTarget`) and the sent target
  (`messageTarget`) rank it first.
- Opening another chat drops it, because the key no longer matches.
- The `PATCH` still persists it as the chat's default.

**Same family: "the panel's card follows the highlighted model".** The card
read "Auto…". The panel had been opened before the model list loaded, while the
target was still the `auto` guess. It set its highlight once, on open, and
didn't follow when the list settled on Echo.

- Fix in `packages/composer/src/components/target-picker.tsx`: the highlight
  is derived from the current choice until the person moves it (key, pointer
  or search).
- Unit test: "follows the current choice the model list settles on, until the
  person moves (132)". It fails without the fix.

**Same root cause: chat-markers "switching model mid-chat marks the switch
once".** Parrot was picked right after the first turn, while the title watch
was polling. The next run went out on Echo, so no marker appeared. The fix
above covers it.

**Regression test:** `composer.spec.ts` "a model picked while the chat's
details load stays picked (132)".

- It holds the chat's reads and its `PATCH` with `page.route`. A held read
  answers with the chat as it was when read, titled with a marker so the test
  knows it has landed.
- It picks GPT-5.2, lands the stale reads, then checks the picker, "Thinking:
  Off" and the run's target.
- Without the fix it failed 1/1 alone and 20/20 under load. With the fix it
  passes every time.

**Numbers.** Load setup: `composer.spec.ts chat-markers.spec.ts
--repeat-each=20 --workers=4` through the queue script, with 6 busy-loop CPU
burners on a 10-core machine.

| Test (out of 20 repeats) | Before the fix | After the fix |
| --- | --- | --- |
| 105 thinking/fast | 8 failed | 0 |
| panel card | 4 failed | 0 |
| chat-markers | 2 failed | 0 |
| new 132 test | 20 failed | 0 |
| "+ menu … web search" | 1 failed (90 s test timeout) | 0 |
| **Total** | **35 failed / 121** | **121 passed / 121** |

**Different cause: harness "a new message while a change waits skips the
change".** This is a server race and is not fixed here. It belongs in
`packages/server`.

- The approval card is streamed during the pass. The run row only becomes
  `awaiting_approval` after the pass ends: `proposedEdits`, then
  `updateMessage`, then `transition` (`runs/executor.ts` ~610–640).
- A message sent in that window finds the run still `running`, so
  `moveOnFromWaiting` (`runs/create-run.ts`) doesn't cancel it. The new turn is
  queued behind a run that then waits for approval indefinitely. This is the
  case that function exists to prevent.
- A probe that sends right after the card appeared, 12 repeats with 4 workers
  under load, saw the run still `running` at the card in 5/12. In 4/12 it ended
  `[queued, awaiting_approval]`.
- The harness test failed 10/20 with 4 workers and 0/20 with 1 worker under 8
  burners.
- Possible fix: set `awaiting_approval` before publishing the card. Or have
  `moveOnFromWaiting` also cancel a `running` tail that has pending approval
  calls. Or have the executor re-check for queued turns when it parks a run.

**`@workspace/chat-ui#test` under load: not reproduced.**

- 403/403 passed 3 times beside an e2e run with burners.
- 403/403 passed once with `bun turbo test --force` (chat-ui, composer, ui,
  web) under 6 burners.
- Every surviving `.turbo/turbo-test.log` in the other worktrees shows a pass,
  so the failing output is gone.
- `link-preview.test.tsx` has no sub-5 s waits, since `asyncUtilTimeout` is
  5000 in `vitest.setup.ts`. Two candidates remain:
  - "falls back to the letter when the favicon doesn't load" waits for the
    Vite server to answer `/api/link-preview/image?src=missing` before `onerror`
    fires.
  - The hover card has a 300 ms open delay.
- Next time it fails, keep that log.

**Another flake seen once in the full e2e: `skills.spec` "an agent lists its
skill and loads it with load_skill".**

- The second message was typed and Entered about 0.4 s after the first, on a
  new `/?agent=` chat. The trace shows no second `POST /api/runs` (or
  `/conversations`) at all, so the message was never sent. It wasn't a target
  problem.
- It passed 5/5 on rerun, and the next full run was 90/90.
- Not investigated further. It looks like a send during the new chat's first
  navigation being dropped.

**Queue script:** `.tools/e2e.sh` already passes arguments through (`bun turbo
test:e2e -- "$@"`). Paths are relative to `e2e/`, for example
`composer.spec.ts -g 132`. No change needed. `--repeat-each` repeats only the
`chromium` project; setup runs once.

**Verification:**

- `bun run check` and `bun run check:guards` exit 0.
- `gate.sh`: 93/93 turbo tasks; `evals --strict` ok.
- Full e2e via the queue on 3297: 89/90 (the `skills.spec` flake above), then
  90/90.

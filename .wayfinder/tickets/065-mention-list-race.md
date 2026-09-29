---
id: "065"
title: "@ file list misses files that load after the last keystroke"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

064 found that the "@hello.md" e2e failed in 5 of 6 runs under load (1 in 3 on unchanged main). The composer's `@` menu
reads `files` only when a key is pressed. If the workspace listing arrives after the last keystroke, the file option never
appears until you type again. The test now retypes as a workaround, but the race is still in the app.

## Done when

- When `files` (or other mention candidates) change while the `@` menu is open, the open menu refilters and shows them
  without another keystroke (`packages/composer`: the suggestion items source reads the latest candidates, and a prop
  change re-renders the open menu).
- `connected-chat.tsx` fetches the file listing early enough that it's usually ready: for example when the composer is
  focused, or when `@` is typed for the first time, and not only once the panel is open.
- A composer browser test opens `@`, then supplies `files` later, and the option appears with no further typing.
- Revert the retype workaround in `e2e/tests/workspace.spec.ts` "@hello.md" and confirm the test passes 5/5 in a row.
- Gate passes; e2e passes.

## Owns

`packages/composer/src/**`, `packages/chat-ui/src/chat/connected-chat.tsx`, `e2e/tests/workspace.spec.ts`.

## Results

Branch `t/065-mention-list-race`, not pushed. `status` stays `open`.

**Root cause.** The composer's `items` callbacks already read the latest candidates through the `live` ref, but
TipTap's Suggestion only calls `items` when the suggestion's text, query or range changes. Nothing asked again when
`files` changed, so an `@hello` typed before the workspace listing landed matched nothing, and the menu stayed shut
until the next keystroke. It also stayed shut when the query had matched nothing: the renderer only kept a menu while it had
items, so there was no "open" state to refresh.

**Fix** (`packages/composer/src`).
- `hooks/use-suggestion-menus.ts`: each renderer records a `requery` for the active suggestion, from `onStart` to
  `onExit`, even when its query matched nothing. The new `refresh(sources)` re-runs the filter for that suggestion's
  current query and range, and redraws through `keepWhileLoading`. The menu opens, grows or shrinks, and a later
  loading update keeps the refreshed list. The same query keeps its active row, clamped.
- `components/composer.tsx`: an effect calls `menus.refresh` with `filterMentions(candidates, …)` and
  `slashItems(…, slash)` whenever `candidates` (agents, people, files) or the slash sources change. It runs after the
  layout effect that updates `live`, so the plugins' own next request sees the same lists. This covers `@` and `/open:`.
- `connected-chat.tsx`: **no change needed.** 062 lists files with its own `sandbox.listFiles` query. It isn't gated on
  the panel: it's enabled as soon as the chat's `sandbox.get` record is ready or stopped, from mount. That's the
  earliest the client can list, because it needs the sandbox id from `sandbox.get` and the contract is frozen. Waiting
  for the composer to be focused, or for the first `@`, would start later, not sooner. Under load the listing can still
  land after typing, and the composer fix covers that.

**Tests.**
- `composer.test.tsx` (browser): type `fix @app` with no files, so no menu shows. Rerender with `files` and the option
  appears with no more typing, and Enter inserts it. The same for `/open:`, where a file that arrives is added to the
  open Files list. Both fail on the old code.
- `use-suggestion-menus.test.ts`: `refresh` opens a menu for an active query that matched nothing, a loading update keeps
  the refreshed list, and after exit a refresh does nothing.
- `e2e/tests/workspace.spec.ts` "@hello.md": 064's retype loop (b060ab0) is reverted. The test now holds the
  workspace listing (`page.route`, batched or not) until `@hello` is typed. It checks that the option isn't showing,
  releases the listing, and expects the option. This exercises the race every run instead of only under load. Without
  the composer fix (apps/web rebuilt from main's composer) it fails every time. With the fix:
  `bunx playwright test e2e/tests/workspace.spec.ts --repeat-each 5` passed 45/45, and "@hello.md" passed 5/5. The whole
  spec was repeated because the chain needs its earlier tests: run alone with `-g`, the card test stalled at "Waiting for
  the agent" on a cold server in 2 of 5 runs, which has nothing to do with this change.
- Composer suite 85/85.

**Checks.** `gate.sh`: install unchanged, check and guards clean, `turbo typecheck lint test build` 82/82.
`E2E_PORT=3501 bun turbo test:e2e`: 32/32.

**Left / noticed.**
- `packages/composer/README.md` ("Suggestions") could say that an open menu refilters when the host's lists change.
  It's outside Owns.
- Seen once: running only the file-chain tests on a fresh server (`-g`), the first `[tool:write]` approval sometimes
  sat at "Decision sent. Waiting for the agent…" past 30 s. It doesn't happen in the full suite, where earlier specs warm
  the server. It wasn't investigated.

## Resolution (2026-09-30, loop)

Merged in [PR #55](https://github.com/connorwforsyth/openchat/pull/55). An open `@` or `/open:` menu refilters when candidates change; the e2e now forces the race deterministically (45/45 on repeat). e2e 32/32, gate 82/82.

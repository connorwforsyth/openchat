---
name: verify-web
description: Launch a disposable copy of the chat web app (apps/web, Next.js 16) on its own port with an embedded database and mock models, drive it in a real browser with Playwright the way a user does, and capture screenshots, ARIA snapshots and API read-backs as proof. Use to confirm a UI or API change works in the running app (sign-in, chat, the rail and its panels, the chat list, full-screen settings, ⌘K palette, memory), not only in unit tests.
---

# Verify the web app

The surface is the browser UI of `apps/web`. The harness is the repo's own
e2e server, `e2e/support/serve.ts`, which runs `next dev` (or `next start`)
on an otherwise empty environment:

- an embedded PGlite database in a fresh temp dir, migrated on the first API
  request, deleted on exit, so every launch starts with no users;
- an `app.config.yaml` it writes itself, whose only providers are
  `e2e/support/mock-llm.ts`, a local OpenAI-compatible mock (plus a mock
  SearXNG, an MCP fixture and the artifact runtime);
- an explicit env (generated auth secret and encryption key), with nothing
  inherited from your shell.

So the user's root `.env` and `app.config.yaml` are never read here, and the
"source `.env` and set `CONFIG_PATH`" step that the user's own `next dev`
needs does not apply. The brand on this instance is `E2E Chat`.

Everything below runs from the repo root. Scripts live in
`.claude/skills/verify-web/scripts/`.

## Spend rule (hard)

The user's AI Gateway credit is real money. Never send a model request that
reaches a paid provider.

- Drive only an instance this skill launched: its providers are loopback
  mocks, and `doctor.sh` refuses to pass otherwise.
- Never drive `http://localhost:3000` or any instance you didn't start. It's
  the user's, and its config may point at the Gateway.
- When a journey needs a model reply, use the mock's directives (below). If a
  check truly needs a real model, use local Ollama with its cheapest model
  (`qwen2.5:3b`, `curl -s localhost:11434/api/tags` to confirm it's up) and
  say so in the report, or stop the journey before the send and report it
  unverified. Never add a Gateway, OpenAI or Anthropic key to make it pass.

The mock answers by the last user message: plain text echoes as
`Echo: <message>`; `remember <fact>` calls `update_memory`;
`[tool:<name> <json>]` calls that tool; `[search:<q>]` calls `file_search`;
`[script:<name>]` plays a scripted multi-step turn; `[slow]` streams slowly.
Chat titles come out as `Topic <first three words>`. The full list is at the
top of `e2e/support/mock-llm.ts`.

## Launch

```sh
.claude/skills/verify-web/scripts/launch.sh
# options: VERIFY_PORT=3111  VERIFY_MODE=prod  VERIFY_RUN_ID=my-run
```

It refuses port 3000 and any port already in use. Port 3100 is the default
in every checkout: launch sets `E2E_PORT`, which overrides the per-worktree
port `serve.ts` would otherwise pick. It runs `bun install` if
`node_modules` is missing, builds `apps/artifacts/dist` if missing, and
regenerates the sources that turbo's `dev` depends on
(`i18n:compile icons:select fonts:select`). Without those, every page is a
500 for `@/lib/fonts.selected`. Then it starts `serve.ts` in the background.

- `VERIFY_MODE=dev` (the default) runs `next dev`, which reflects your
  working-tree edits. A route compiles on its first visit, and the signed-in
  shell takes 30-60 s cold, longer than a journey's 30 s expect timeout. So
  before READY, launch visits `/`, `/c/<id>`, `/settings/profile`,
  `/library`, `/schedules`, `/artifacts` and `/dots` once with a placeholder
  session cookie (`launch: warmed <route> (307)`). A cold launch takes about
  5 minutes. Turbopack's cache in `apps/web/.next/dev` makes the next one
  much faster. A route you add to a journey that isn't in that list
  compiles inside the journey; add it to the list in `launch.sh`.
- `VERIFY_MODE=prod` runs `next start` on `apps/web/.next`, building it if
  there's no build. A stale build verifies old code: delete
  `apps/web/.next` after changing source.

Ready means `GET /api/config` answers (the database is open and migrated) and
`/sign-in` renders `E2E Chat`. Launch prints `launch: READY
http://localhost:3100` and `RUN_DIR=<repo>/.context/tmp/verify-web/<run id>`.
The run dir holds `server.log`, `server.pid`, `pids`, `port`, `mode` and
`evidence/`. `.context/tmp/verify-web/active` points at the current run.

## Doctor

```sh
.claude/skills/verify-web/scripts/doctor.sh [RUN_DIR]
```

This is read-only. Run it first, and again whenever anything looks off. It
checks that `serve.ts` is alive, that the listener on the port descends from
it (not someone else's server), that every provider `baseURL` in the
server's config is loopback and the decider is off, and that the app
answers as `E2E Chat`. It ends with `doctor: HEALTHY <url>`. Any `FAIL` means
you don't drive the instance. Fix the cause or relaunch.

## Drive

Journeys are Playwright tests in `journeys/*.journey.ts`, run through
`playwright.verify.config.ts` (which has no `webServer`, so it drives the
active run only):

```sh
.claude/skills/verify-web/scripts/journey.sh             # every journey
.claude/skills/verify-web/scripts/journey.sh chat        # one, by name
.claude/skills/verify-web/scripts/journey.sh chat memory
```

`accounts` runs first on a fresh instance, because its sign-up is the first
one and makes the admin (`ada@e2e.test`). It saves the session to
`$RUN_DIR/auth/ada.json`, and every other journey runs as that user. Later
invocations on the same instance skip it. Journeys put a fresh tag in their
text, so they can be rerun on the same instance.

Known product failures as of 2026-10-21. Report them; never weaken the
step:

- `palette` › one ⌘K on a chat screen fails every time. See
  `features/palette.md`.
- `sidebar` › the immediate-reload step fails about 1 run in 4 until the
  persisted-cache fix merges. See `features/sidebar.md`.

To check something no journey covers, write a new `journeys/<name>.journey.ts`
from an existing one (and add a feature file, below). Import `test` from
`./fixtures`, not from `@playwright/test`. Its automatic fixture hides
Next's dev error overlay (`<nextjs-portal>`), which otherwise swallows
clicks after any console error (a hydration mismatch is enough), and logs
every console error and page error to `evidence/console-errors.log`. Reuse the repo's
helpers in `e2e/support/`: `chat.ts` (`send`, `expectReply`,
`composerReady`, `conversationIdOf`, `chatHeader`, `openWorkspace`,
`pickTarget`, `plusMenu`), `users.ts` (`signIn`, `signUp`), `hydration.ts`
and `api.ts` (`apiFor(page, baseURL)`, a typed API client on the page's
cookies, for reading back side effects). Use roles and accessible names, and the
shell handles in `journeys/handles.ts`. The stable handles are:

- the composer: `getByRole("textbox", { name: "Message" })`, and its `Send`
  and `Stop` buttons under `[data-slot="composer"]`;
- messages: `.is-user[data-message-id]` and `.is-assistant[data-message-id]`;
- the rail: `rail(page)`, `navigation "Sidebar rail"`, with `Toggle
  sidebar`, `Chats`, links `Scheduled`, `Library` and `Artifacts`, and
  `Account: <name>` (menu items `Settings`, `Sign out`);
- the panel: `sidebar(page)`, `complementary "Chats"`, with the space
  switcher (`getByTestId("space-switcher")`), `navigation "Primary"` (`New
  chat`, `Search chats`) and the chat rows. Find a row with
  `chatRow(page, title)`: a row in `Priority` is named `<title> Unread`.
  Each row has an `Actions for <title>` menu button;
- settings: `settings(page)`, `dialog "Settings"`, with `navigation
  "Settings sections"` and `Back to app`;
- the header: `[data-slot="app-header"]`;
- the palette: `ControlOrMeta+K`, then the `Search or type a command…`
  placeholder.

`playwright.verify.config.ts` keeps the browser's own user agent. The app
picks ⌘ or Ctrl from the user agent while `ControlOrMeta` presses the
host's key, so a device preset's user agent breaks shortcuts on a Mac.

## Evidence

Each journey step calls `proof(page, feature, step, sideEffect?)` from
`journeys/evidence.ts`. That writes `$RUN_DIR/evidence/<feature>/<step>.png`
(a full-page screenshot), `<step>.aria.txt` (the URL and the ARIA snapshot)
and, when given, `<step>.json` (the API read-back). Playwright adds a
screenshot per test and a trace on failure under `evidence/test-results/`.
`evidence/journeys.log` has the runner output. `evidence/console-errors.log`
has the browser's console errors, keyed by test. Mention any entry in your
report, because the overlay that would have shown it is hidden. The log was
empty on a full run on 2026-10-21. `server.log` has the server-side copy of
a hydration diff.

`proof()` takes screenshots with `caret: "initial"`. Playwright's default,
`caret: "hide"`, writes an inline `caret-color` onto every textarea, and on
a page that hasn't hydrated yet React logs that as a hydration mismatch on
the composer. Pass `caret: "initial"` to any screenshot you add.

The proof standards:

- Drive the real user path: the composer, menus and shortcuts. Use the API
  only to read back what the UI implied, or to set up state the feature
  under test doesn't own.
- Capture the action and the resulting state, not only the final screen.
- Verify side effects, such as the stored title or the memory file,
  through `apiFor` or a second view (reload, Settings), next to what's
  visible.
- The mock model is the only mock. It sits behind the app's ordinary
  `openai-compatible` provider boundary, so the app's own code path is real.
- Report a journey that fails as failed, with its trace. Never weaken an
  assertion to make it pass.

## Cleanup

```sh
.claude/skills/verify-web/scripts/cleanup.sh [RUN_DIR]
```

It sends SIGTERM to the `serve.ts` it started, which stops `next`, the
mocks and the artifact runtime and deletes its temp dir (database, uploads,
config). Then it kills any pid recorded in `$RUN_DIR/pids` that is still
alive. It never kills by process name. It removes `$RUN_DIR/auth` (session
cookies) and keeps `$RUN_DIR/evidence/`. Run it after every run, failed ones
included, and check that it prints `evidence kept in …`. Evidence dirs are
gitignored (`.context/tmp/`). Delete old ones by hand when they're no longer
needed.

## Features

`features/README.md` indexes the verification map: one file per user-facing
feature, with entry points, the journey, and gotchas. Read the feature's file
before driving it, and update the map when the app changes.

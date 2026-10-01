---
id: "118"
title: "Desktop Quick AI: a global-shortcut window"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

## Done when

- A global shortcut (configurable; default ⌥Space) opens a small floating composer window anywhere. Send starts a chat on the instance; Escape hides it; ⏎ with ⌘ opens it in the main window.
- The tray offers the same thing. Lives in Electron main, reuses the composer. Tests and gate pass.

## Owns

`apps/desktop/**`.

## Results (2026-10-02, loop)

Built on `t/118-quick-ai`, not pushed. Includes the tray deferred from 117.

- **Quick AI window** (`apps/desktop/src/main/quick-ai.ts`): frameless,
  always on top, a `panel` on macOS (over full-screen apps and every
  Space), centred across the display under the pointer with its tallest
  size centred down it, so it grows downwards. It loads the instance's own
  **`/quick`** page in the same partition and session, made on first use
  and then hidden rather than closed (a reply keeps streaming while
  hidden). Its height follows the page through Electron's preferred-size
  mode, between the composer alone (96px) and 560px; it shrinks while
  hidden so the page re-measures. Escape hides it (the page asks through a
  new bridge call, `hideQuickAi`, honoured only from that window's own main
  frame); so does losing focus or ⌘W.
- **`/quick`** (`apps/web/app/(quick)`): its own route group with the
  signed-in check and `AppFrame`, minus the global surfaces (palette, `?`,
  global shortcuts), which would navigate a one-page window. The composer
  (`ComposerLoader`, unchanged) and a compact reply (`Markdown`, Thinking…,
  Open in the app). Every send creates a chat (`conversations.create`,
  personal context, the person's default target or the server's) and runs
  it with `useRunChat`. ⌘⏎/Ctrl+Enter: the page waits for the run to exist,
  then goes to `/c/<id>`; in the shell that navigation is refused in the
  Quick window and the main window opens the chat, where
  `useFollowRunningReply` picks the stream up. Text only for now
  (`maxFiles: 0`). No contract change.
- **Locks:** 116's rules plus `decideQuickNavigation`: the Quick window
  stays on `/quick`; anything else on the instance goes to the main window
  (a sign-in redirect's `next=/quick` is dropped), other origins and
  schemes as before. Same preload, sandbox, permissions.
- **Global shortcut** (`quick-shortcut.ts`): `settings.json`
  `quickAi.shortcut`, in the web app's combo notation (aliases like `Cmd`,
  `Option` accepted), default `Alt+Space`, `null` for none. **Quick AI
  Shortcut** in the menu offers ⌥Space, ⌃Space, ⌘⌥Space, ⌘⇧Space and No
  Shortcut (plus a custom one from the file). A combo another app holds, or
  one without ⌘/Ctrl/⌥, shows a warning dialog naming it and says Quick AI
  is still on the menus; nothing stays registered. `unregisterAll` on
  `will-quit`; `before-quit` destroys the hidden window so it can't block
  quitting.
- **Menus:** Quick AI (showing the shortcut) and Quick AI Shortcut in the
  app menu (File menu off macOS). **Menu bar icon (macOS):** New chat,
  Quick AI, Show Window, Quit. The icon is a placeholder speech-bubble
  outline drawn in code as a template image (`tray-icon.ts`); **119
  replaces it** with the brand's.
- **Tests:** desktop unit tests 121 in all; new: shortcut parsing,
  registration and messages, Quick window placement and height, the Quick
  navigation rule, settings, the menus and tray menu, the icon bitmap.
  `packages/shortcuts`: the bridge's `hideQuickAi`. Desktop smoke test
  (`E2E_DESKTOP_PORT=3293`, passed 4 runs in a row): Quick AI from the tray
  menu and the app menu, a centred always-on-top window on `/quick` with
  the bridge and no app chrome, a reply in the window, its height following
  the page, external links, Escape hiding and shrinking it, ⌘⏎ opening the
  chat in the main window with the reply, the shortcut from settings.json
  registered and shown in the menu, a taken one reported (dialog stubbed)
  with the old one released, No Shortcut saved, and the shortcuts released
  on quit. It uses ⌃⌥⇧F12 so it never takes a real key. Web e2e
  `quick.spec.ts`: answers on the page, Open in the app, ⌘⏎ to the chat,
  signed out to sign-in.
- **Verification:** `gate.sh` 93/93 tasks, `evals --strict: ok`; `bun run
  check` and `check:guards` exit 0. Web e2e through the queue on 3294: 87
  passed, none failed or flaky.

Touched outside **Owns**: `apps/web` (the `/quick` route group,
`AppFrame`'s `surfaces` prop, `routes.quick`, the proxy matcher),
`packages/shortcuts/src/desktop.ts` (`hideQuickAi` on the parsed bridge),
`e2e/` (smoke test, `quick.spec.ts`, `QUICK_URL`) and the catalog. No
composer changes.

Open:
- Chromium doesn't report preferred-size changes while Playwright drives a
  page, so the smoke test replays the event; the real growth was checked
  by experiment only. Worth a look by hand.
- `type: "panel"` should keep focus with the app you were in when Quick AI
  hides; not testable here. Check by hand that hiding returns focus to the
  previous app and doesn't raise the main window.
- The composer's `/` and `@` menus open above it, so in the Quick window
  they'd be clipped; with no prompts, agents or people passed they have
  little to show. A Quick-specific placement, or a model picker, is a
  follow-up.
- Attachments are off in Quick AI; they need the chat screen's upload and
  workspace handling.
- The tray is macOS only (122: macOS first); Windows/Linux need a
  non-template icon.

---
id: "117"
title: "Desktop native chrome: title bar, menus from the shortcut registry, tray"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

## Done when

- **Title bar (D14):** macOS `titleBarStyle: 'hiddenInset'`, with the header as the drag region (`no-drag` on controls). Windows and Linux use a matching custom bar with window controls.
- **Menus:** native menus generated from `packages/shortcuts` (the same accelerators as the web: ⌘K, new chat, stop, toggle sidebar, switch model, copy last reply).
- **Tray / menu-bar icon:** New chat, Quick AI, Quit.
- Window state remembered. Tests for the menu-from-registry mapping. Gate passes.

## Owns

`apps/desktop/**`, `packages/shortcuts/**` (Electron accelerator mapping).

## Results (2026-10-02, loop)

Built on `t/117-desktop-chrome`, not pushed. Adapted to 116's design (the
shell loads the instance's own web app).

- **Menus from the registry.** `apps/desktop/src/main/menu.ts` places
  registry ids in the app menu (macOS), File, View, Chat and Help. Labels are
  the registry's descriptions; accelerators come from
  `@workspace/shortcuts/electron` (⌘K, ⌘B, ⌘, and ⌘.). Single-key shortcuts
  (N, J, /, [, ]) get items without accelerators, since an accelerator would
  fire while typing. A click sends the shortcut id over
  `desktop:menu-command`. `OFF_MENU` lists the ids with no item and why, and
  a test keeps every id either in a menu or on that list.
- **Menu commands are shortcut ids.** The brief named the commands
  `new-chat`, `open-palette` and `toggle-sidebar`; `menuCommandSchema` is
  now the registry's id enum (`chat.new`, `palette.open`, `sidebar.toggle`,
  …), so no command is named twice. The ids moved to
  `packages/shortcuts/src/ids.ts`, which has no Lingui, so the sandboxed
  preload can import them.
- **Web side.** `@workspace/shortcuts/desktop` reads `window.desktop`,
  parsed with zod (an unknown bridge counts as "not in the shell").
  `useShortcut`, and chat-ui's own `useShortcuts` for the chat screen, run
  their handlers on a menu command too, so every bound shortcut works from
  the menu without extra wiring. `useDesktopPlatform()` reads the
  platform. The server render says "web" and the shell corrects it after
  hydration, so nothing changes in a browser.
- **Title bar (macOS).** The main window is `hiddenInset`, with the traffic
  lights at (16, 17), centred in the 48px header. The header drags the
  window and its controls don't (that code was already in chat-ui). The
  header now leaves room for the lights whenever the sidebar isn't docked
  (from `useSidebarDocked`, so a sidebar squeezed out by the panel counts).
  The sidebar's top row gets an 80px inset and drags the window. Sign-in,
  sign-up and invite pages get a drag strip along the top. Windows and
  Linux keep the native frame for now (122: macOS first), so the web app
  lays out as "web" there.
- **Window state.** Bounds and maximised state go into `settings.json`
  (`window`) 500 ms after a move or resize, and on close. Settings writes
  are serialised. `placeWindow` restores the saved position only while the
  window's top strip is on a display; otherwise it keeps the size and lets
  the OS place it.
- **Tray: deferred.** Its items are New chat, Quick AI and Quit. Quick AI is
  118, and the menu-bar icon asset belongs with packaging and icons (119),
  so the tray lands with 118.
- **Tests:** menu-from-registry mapping (9), window placement (7),
  settings (5), bridge parsing (6), and `useShortcut` on a menu command
  (browser). The desktop smoke test checks: the header and sidebar-row drag
  regions; the 80px inset; menu labels and accelerators from the registry;
  sidebar toggle, palette and new chat each driven from the menu into the
  web app; and the bounds saved after `setBounds`.
- **Verification:** gate 92/92 tasks, `evals --strict: ok`, check and
  guards exit 0. `bun turbo test:desktop`: 1/1 passed (on
  `E2E_DESKTOP_PORT=3291`). Web e2e through the queue on 3282: 73 passed,
  1 failed. The failure was `composer.spec` "thinking level and fast mode
  sit apart" (known flaky; the model was `mock:echo` instead of
  `mock:openai/gpt-5.2`), and it passed on a rerun.

Touched outside **Owns**, for the web side the brief asked for:
`packages/chat-ui` (header coverage, sidebar top row, the chat screen's
shortcuts hearing menu commands, a dependency on `@workspace/shortcuts`),
`apps/web` (passing the platform to the shell, the sign-in drag strip),
`e2e/desktop`, and the catalog (one new string, "Chat").

Open:
- The menu shows the registry's default keys, not a person's recorded
  overrides, which live in the web app's settings. Fixing that needs a
  page→main channel to report bindings.
- `run.stop` and `reply.copy` have no web binding yet, so they're left out
  of the menu.
- An older instance whose web app predates this change gets no drag region
  under `hiddenInset`, and its traffic lights overlap the page.
- The Windows and Linux custom bar (`titleBarOverlay`) needs colours from
  the theme in main.

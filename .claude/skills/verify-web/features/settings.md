# Full-screen settings

Settings open as a full-screen view over the current page. The view takes
the whole window, the app's sidebar included. Its address is
`/settings/<section>`, so a section can be linked to. Switching sections
replaces the address, and `Back to app` or Escape returns to the page that
opened it. The Appearance section's `Sidebar layout` changes the shell
behind it.

## Sub-features

- `settings-open-menu`: `Account: <name>`, then menu item `Settings`.
- `settings-open-shortcut`: `Mod+,` from any signed-in page.
- `settings-open-palette`: the palette's `Open settings` (see `palette.md`).
- `settings-open-address`: a hard load of `/settings/<section>` renders the
  new chat with settings over it. Closing leaves the address at `/`.
- `settings-sections`: `navigation "Settings sections"` holds `Profile and
  language`, `Provider keys`, `MCP servers`, `Memory`, `Shortcuts` and
  `Appearance` (and `Admin` for admins). Each is a button, and the section's
  `h1` names it.
- `settings-close`: `Back to app` or Escape closes the view and returns to
  the page under it.
- `settings-layout`: Appearance › `Sidebar layout` with `Rail
  (recommended)` and `Classic`. It is stored in localStorage
  `sidebar-layout:<userId>`.
- `settings-space`: for a non-personal space, Space sections show under
  `Space: <name>` (`space-members`, `space-subspaces`, …). Not in the
  journey, because a new user has only the Personal space. See
  `e2e/tests/orgs.spec.ts`.

## How to get to it (user POV)

- The account menu at the foot of the rail, then `Settings`.
- Press `Mod+,`.
- Open the palette and run `Open settings`.
- Load `/settings/<section>`, for example `/settings/memory`.

## Driving it with verify-web

Preconditions:

- Healthy instance, with the `accounts` journey done.
- The layout is Rail. The journey switches it to Classic and back.

- **Open from the account menu.** On `/`, choose `Account: Ada Admin`, then
  `Settings`. Run `scripts/journey.sh settings`. `dialog "Settings"` is
  visible, the URL is `/settings` or `/settings/profile`, Ada's email shows,
  and the dialog's box equals the viewport. Proof:
  `settings/01-open-from-account-menu`.
- **Switch section.** In `navigation "Settings sections"`, choose `Provider
  keys`. The URL ends `/settings/keys`, and the `h1` is `Provider keys`.
  Proof: `settings/02-section-keys`.
- **Change the layout.** Choose `Appearance`, then `Classic` in `group
  "Sidebar layout"`. localStorage `sidebar-layout:<userId>` holds
  `classic`. Proof: `settings/03-layout-classic.{png,aria.txt,json}`.
- **Back to app.** Choose `Back to app`. The dialog is gone, the URL is `/`,
  the rail is hidden, and `navigation "Primary"` has a `Library` link.
  Proof: `settings/04-classic-shell`.
- **Shortcut.** Press `ControlOrMeta+Comma`. The dialog opens. Choose
  `Appearance`, then `Rail (recommended)`, and press Escape. The dialog is
  gone, the URL is `/`, and the rail is back. Proof:
  `settings/05-rail-again`.
- **Address.** Load `/settings/memory`. The dialog shows with the `h1`
  `Memory`. Press Escape. The URL is `/`. Proof:
  `settings/06-address-closes-to-home`.

## Gotchas

- The app picks ⌘ or Ctrl from the user agent, and `ControlOrMeta` presses
  the host's key. `playwright.verify.config.ts` keeps the browser's own user
  agent so the two agree. A Playwright device preset brings its own user
  agent (Windows for `Desktop Chrome`), which makes `Mod+,` dead on a Mac.
- The shortcuts bind after boot, as the palette does. Retry the first press
  inside `expect(...).toPass()`.
- The app's sidebar stays mounted under the modal dialog. Prove "full
  screen" with the dialog's box, not with the sidebar being hidden.

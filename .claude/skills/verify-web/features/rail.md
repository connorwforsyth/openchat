# Rail and panels

On wide screens a thin rail sits at the window's edge, and the panel beside
it shows what the rail selects. `Chats` shows the chat list, and
`Scheduled`, `Library` and `Artifacts` go to their pages with a panel of
their own. The panel's top row holds the space switcher and the Dot entry.
`Toggle sidebar` collapses the panel, and the choice survives a reload.

## Sub-features

- `rail-chats`: the `Chats` button shows the chat list. On a page other
  than a chat it also goes to `/`.
- `rail-panels`: `Scheduled`, `Library` and `Artifacts` are links to
  `/schedules`, `/library` and `/artifacts`. The current one has
  `aria-current="page"`, and the panel becomes `navigation "<name>"` with an
  `<name>` heading.
- `rail-collapse`: `Toggle sidebar` (or `Mod+B`) collapses and expands the
  panel. The state is in localStorage `chat-ui:layout` and survives a
  reload.
- `rail-space-switcher`: `Space: Personal` (`data-testid="space-switcher"`)
  opens the `Spaces` menu with a `Personal` radio item.
- `rail-dot-entry`: `Make your Dot` goes to `/dots`, which shows the
  onboarding `Meet your Dot` for a user with no Dot.

## How to get to it (user POV)

- The rail is `navigation "Sidebar rail"`: `Toggle sidebar`, `Chats` (named
  `Chats, N needs attention` when a chat does), links `Scheduled`, `Library`
  and `Artifacts`, then `Account: <name>`.
- The space switcher and `Make your Dot` sit at the top of the `Chats`
  panel.
- Settings › Appearance › `Sidebar layout` switches between `Rail
  (recommended)` and `Classic`. See `settings.md`.

## Driving it with verify-web

Preconditions:

- Healthy instance, with the `accounts` journey done. Ada has no Dot and no
  scheduled tasks or artifacts.
- The layout is Rail, the default.

- **Chats panel.** Open `/`. Run `scripts/journey.sh rail`. `rail(page)` is
  visible, and the panel has `navigation "Primary"`. Proof:
  `rail/01-chats-panel`.
- **Scheduled.** Choose rail link `Scheduled`. The URL ends `/schedules`,
  the link has `aria-current="page"`, and `navigation "Scheduled"` has the
  heading `Scheduled` and the text `Nothing scheduled yet.` Proof:
  `rail/02-schedules-panel`.
- **Library.** Choose `Library`. The URL ends `/library`, and
  `navigation "Library"` lists `Shared with me`. Proof:
  `rail/03-library-panel`.
- **Artifacts.** Choose `Artifacts`. The URL ends `/artifacts`, and
  `navigation "Artifacts"` shows `Nothing yet.` Proof:
  `rail/04-artifacts-panel`.
- **Back to chats.** Choose the rail's `Chats` button. The URL is `/`, and
  `navigation "Primary"` is back.
- **Space switcher.** `getByTestId("space-switcher")` is named `Space:
  Personal`. Choose it, and `menuitemradio` `Personal` shows. Proof:
  `rail/05-space-switcher`. Press Escape.
- **Dot entry.** Choose `Make your Dot`. The URL ends `/dots`, and the
  heading `Meet your Dot` shows. Proof: `rail/06-dot-onboarding`.
- **Collapse.** On `/`, `Toggle sidebar` has `aria-expanded="true"`. Choose
  it, and it is `"false"`. Reload, and it is still `"false"`. Proof:
  `rail/07-collapsed-after-reload.json` holds localStorage `chat-ui:layout`.
  Choose it again to expand.

## Gotchas

- The rail and the rail panels exist only at `md` widths and up. Under
  768px the panel is a drawer. In the Classic layout there is no rail, and
  `Library`, `Artifacts` and `Scheduled` are links in `navigation "Primary"`.
- The section headings in the `Chats` panel are `h3` buttons that expand
  and collapse their section. They are sections labelled by the heading,
  not `region` landmarks with an `aria-label`.
- Once a user has a Dot, `Make your Dot` is replaced by the Dot's row, and
  `/dots` redirects to the Dot's chat. Relaunch to retest the onboarding
  entry.
- The Dot onboarding stops before `Say hi to <name>`, which starts a model
  turn. The journey never makes a Dot.

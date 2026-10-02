---
id: "135"
title: "Quick AI: a native-feeling strip (input + button, translucent, no hints, no scrollbar)"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02), after trying 118: "I'd rather the quick AI look and feel a little bit more native - i.e. just a strip the input and a button - maybe with some transparency - and the keyboard shortcuts not being below - there's also a scrollbar to the quick composer which is a big no no."

## Done when

- **Idle:** Quick AI is a single strip with just the text input and a send button. No toolbar, no + menu, no model picker and no shortcut hints underneath.
- **Look:** the macOS window is translucent (native vibrancy, e.g. `vibrancy: "hud"`/`"popover"` with a transparent page background), with rounded corners and a native shadow. It looks right in light and dark.
- **No scrollbar:** none in the input or anywhere in the window, at any height. A long input grows to a cap and then scrolls without a visible bar.
- **Reply:** the reply area appears below the strip only once there's a reply, keeping the same native look and without a visible scrollbar.
- **Raycast ⌘K style** (Connor, 2026-10-02: "it should be a little bit like raycast command k style"):
  - a wide, fairly tall single input row with large text (about 18–20px), a placeholder like "Ask anything…" and a small icon at its start;
  - a hairline divider under the input once there's something below it;
  - a compact, muted footer bar only while a reply shows, with the action hint on the right ("Open in the app ⌘↵"); no hint rows otherwise;
  - the reply in a list-like panel below with comfortable padding and no visible scrollbar;
  - translucent vibrancy, about a 12px corner radius, a soft shadow, a fixed width of about 680–750px, centred slightly above the middle of the screen.
- Escape, ⌘⏎ and the global shortcut still work. Desktop smoke and the `/quick` e2e are updated, and screenshots are checked by eye.

## Results (2026-10-02, loop)

Built on `t/135-quick-ai-native`, not pushed.

- **Composer** (`packages/composer`): `appearance="strip"` (new prop,
  `ComposerAppearance`, read once at mount). One bare row: the input in
  18px type (`text-lg`, 28px line, 60px tall) and Send/Stop, and nothing
  else (no + menu, picker, thinking level, chips or frame; the footer
  renders Send alone). The input grows to about five lines (`max-h-44`) and
  then scrolls with `no-scrollbar`. Shell and editor share the class lists
  (`LOOKS` in `styles.ts`), so the swap still doesn't move a pixel. The
  strip's frame also cancels InputGroup's grey/50% look while Send is
  disabled. README has a *Strip* section.
- **Window** (`apps/desktop`): `quickWindowLook(platform)` gives macOS
  `type: "panel"`, `vibrancy: "popover"`, `visualEffectState: "active"`,
  `transparent: true`, `roundedCorners`, `hasShadow`; other platforms are
  unchanged. 720px wide (was 680), minimum height 60 (the strip; was 96),
  max 560; placed centred across and a third of the spare room down (inside
  the 16px margins), i.e. a little above the middle. 118's preferred-size
  logic is unchanged.
- **`/quick`** (`apps/web`): Raycast-style. A sparkles icon, the strip
  ("Ask anything…"), and only once there's a reply: a hairline
  (`border-foreground/10`, readable on either material), the reply panel
  (`px-4 py-3`, scrolls hidden), and a 40px muted footer: the question
  (truncated) on the left, "Open in the app ⌘↵" on the right. The hint row
  is gone. ⌘⏎ with nothing typed now opens the reply's chat (what the
  footer advertises); with text it still sends and hands off. The page caps
  itself at 560px (`max-h-140`, same as the window), so the reply scrolls,
  never the page. The `(quick)` layout adds `*{scrollbar-width:none}` (no
  scrollbar anywhere on the page, code blocks included) and, only when the
  request comes from the shell on macOS (`hasNativeMaterial`, the
  `DesktopShell/` user-agent token 117 added for this), makes `html`/`body`
  transparent so the vibrancy shows; in a browser or the app elsewhere the
  page keeps `bg-background`. Text uses the theme tokens throughout.
- **Tests:** composer strip tests (editor and shell: Send alone, Enter
  sends, Stop, hidden scrollbar class); desktop `quickWindowLook` and the
  new placement; `hasNativeMaterial`. Web e2e `quick.spec.ts`: idle strip
  (Send only, no kbd/hints/footer, placeholder), nothing that could show a
  scrollbar (`scrollbarsThatCouldShow`: every scrolling element and the page
  must have `scrollbar-width: none`; headless Chromium never paints bars),
  input capped at 176px and scrolling, a 30-paragraph reply inside a ≤560px
  page with the footer in view, ⌘⏎ on an empty composer opening the reply.
  Desktop smoke: 720px wide, above-middle placement, the strip, see-through
  root/body, no scrollbars, strip height ≤64, reply footer, a long input and
  reply capped at 560 with the reply scrolling, and screenshots idle / reply
  / long in light and dark (`webContents.capturePage`, attached to the
  report).
- **Screenshots:** `/private/tmp/claude-501/135-screens/`:
  `capture-*.png` are the window's page as captured (transparent where the
  material shows), `simulated-material-*.png` the same composited over a
  blurred, tinted wallpaper with 12pt corners and a shadow
  (`composite.py`), to judge contrast. The real NSVisualEffectView material,
  corner radius and shadow are drawn by macOS outside the page and couldn't
  be captured: `screencapture` has no Screen Recording permission here.
- **Verification:** `bun run check` and `check:guards` exit 0 on each
  commit. `gate.sh`: install, check, guards and `evals --strict: ok`; its
  turbo run lost `@workspace/db#test` to load (passes alone, 79/80 with 1
  skipped), and a rerun of `bun turbo typecheck lint test build` was 93/93.
  Desktop unit tests 180, composer 157. Desktop smoke
  (`E2E_DESKTOP_PORT=3303`): 11 of 12 runs passed; the one failure was
  118's ⌘⏎ hand-off step (`press("Meta+Enter")` timed out while the window
  hid). Web e2e through the queue on 3304: the first run had 4 failures in
  specs this doesn't touch (chat-markers, the composer's model panel and
  thinking level, harness Stop); all 22 tests in those files plus
  `quick.spec` passed on a rerun, and a full rerun was 93 passed, none
  failed or flaky.

Touched outside **Owns**: `packages/composer` (the `appearance` prop),
`apps/web` (`(quick)`, `lib/desktop-shell.ts`), `e2e/` (smoke, `quick.spec`,
`support/quick.ts`) and the catalog. No contract changes.

Open:
- Check by hand on a Mac: the real vibrancy, the corner radius macOS gives
  a frameless `transparent` panel (aimed at ~12px, not set by the page) and
  the shadow. The screenshots couldn't show them.
- The material follows macOS's light/dark, the text follows the app's theme
  setting. If someone sets the app to light on a dark Mac, the text and the
  material won't match. Options: set `nativeTheme.themeSource` from the
  app's theme, or add a faint `bg-background` tint to the strip.
- The ⌘⏎ smoke-step flake (1 in 12): a hidden transparent panel may stop
  acking Playwright's keyup. Worth a look if it recurs.
- Translucency depends on the user agent (`DesktopShell/` + `Macintosh`),
  which the server reads in the `(quick)` layout; that's dynamic already.

---
id: "064"
title: "Workspace editor text disappears after switching dark to light"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

062's visual pass: after switching the colour scheme from dark to light while the app runs, the Workspace panel's code
editor (`packages/code-ui/src/code-editor.tsx`, built on the `@pierre/diffs` editor in a shadow root) rendered its text
invisible. It is probably the editor/Shiki theme not following the theme change.

## Done when

- The editor (and the read-only code viewers in code-ui that share the theming) follow light, dark and system theme
  changes live, with no reload: text is readable in both, before and after switching, including while a file is open.
- A browser test switches the theme with a file open and asserts the text colour contrasts with the background (or that
  the editor's theme attribute/variables flip).
- `e2e/README.md` mentions that the mock echoes mentioned workspace files (`[path: content]`).
- Gate passes; e2e passes.

## Owns

`packages/code-ui/src/**`, `packages/chat-ui/src/workspace/**` (theme plumbing only), `e2e/README.md`.

## Results

Branch `t/064-editor-theme-switch`, not pushed. `status` stays `open`.

**Root cause.** Two bugs in how the @pierre/diffs (1.5.1) editor meets our token-based Shiki themes.
- *Invisible text.* Our themes colour code with CSS expressions (`var(--foreground)`, `color-mix(…)`). Shiki can't give those to its TextMate registry, so it swaps each for a placeholder hex (`#00000001`, `#00000002`, …) and keeps the real value in the theme's `colorReplacements`. Shiki's own output (read-only views, diffs) swaps them back. The editor's tokenizer paints straight from the registry's colour map (`highlighter.setTheme(name).colorMap`) and never applies `colorReplacements`, so every line it tokenizes gets `style="color:#00000006"`: black at 2 % alpha. That covers lines you type (invisible in both schemes) and, when the colour scheme changes, the whole file, because the editor re-tokenizes everything on a theme change. That is what 062's visual pass saw. It isn't Shadow DOM, the CSS variables, or stale `themeType` props: those all update.
- *Stale colour scheme.* While editing, the `File` writes `color-scheme` into its shadow root from the scheme the editor last tokenized in. That value is recorded after the render that applies it, so it stays one switch behind: dark in light mode, and the reverse. Our colours don't depend on it, but the library's `light-dark()` mixes (diff tints, selection, hover) do.

**Fix** (`packages/code-ui/src/`).
- `theme/editor-colors.ts`: `prepareEditorColors()` wraps `setTheme` on @pierre's shared highlighter so the colour map it returns has the theme's `colorReplacements` applied (`resolveColorMap`, pure). The wrap is idempotent (WeakSet) and does nothing on the server. Only the editor calls the highlighter's public `setTheme`: Shiki's own tokenizing goes through its internal context, so nothing else changes. `code-editor.tsx` calls it at module load, before any editor mounts.
- `theme/host-styles.ts`: `diffsHostStyle(themeType)` also sets `color-scheme` on the host. The host's own style outranks the shadow root's `:host` rule, so the editor, `CodeView` and `DiffView` stay on the app's scheme. `"system"` (before hydration) leaves it to the library.
- Nothing in `chat-ui/src/workspace` needed to change: the panel already gets the scheme through `useCodeThemeType`.

**Tests.**
- `theme/editor-colors.test.ts`: `resolveColorMap`. Against the real shared highlighter and our themes, the colour map has placeholders before the wrap and only token colours after it, in both schemes. The "before" check is there on purpose: if it fails, the library resolves the colours itself and the workaround can go.
- `e2e/tests/workspace.spec.ts`, "the editor stays legible while the theme switches under an open file". With `hello.md` open it picks Dark from the account menu, types a line (which the editor tokenizes itself), then switches to Light, then to System with the device dark and then light. After each switch it measures the lowest WCAG contrast of every token against the editor background (composited on a canvas, so near-transparent text counts as background) and the shadow root's `color-scheme`, and requires both to be right with contrast > 3. On the old code it fails: `{"contrast": 1.006, "scheme": "light"}` while dark. With only the scheme fix it fails at contrast 1.006.
- The same spec's "@hello.md" test flaked on this machine under load, on `main` too (1 of 3 runs). The `@` list reads a listing that loads after the page, and a query typed before the listing arrives matches nothing until the next keystroke. The test now retypes until the option shows (`toPass`). The app-side race, where the suggestion list doesn't refresh when the listing arrives, is still in `composer`/`connected-chat` and would make a follow-up ticket.
- `e2e/README.md`: the echo ends with each workspace file the turn read in, as `[path: content]`.

**Checks.** `gate.sh`: 82/82. E2E (`E2E_PORT=3491`): 32/32. Before/after screenshots of `/dev/sandbox` (dark, type a line, then light): the text is invisible before and readable after.

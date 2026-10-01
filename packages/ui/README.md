# @workspace/ui

The design system: shadcn components on Base UI, the theme
(`src/styles/globals.css`, the only place colours live) and the AI Elements
we own (`src/components/ai-elements/`, with its own README). Add shadcn
components with the CLI; they're owned source after that.

Components we wrote ourselves, because neither shadcn nor AI Elements has
them:

## `preview-pane.tsx`

A side card that shows the active item of a list beside it (099; the model
picker's details card). Base UI's `PreviewCard` opens on hover over a link,
so the keyboard never drives it; `PreviewPane` follows whatever value the
list says is active, so arrow keys and the pointer both move it.

```tsx
<PreviewPane value={active} onValueChange={setActive}>
  <PreviewPaneList>
    <Command value={active} onValueChange={setActive}>…</Command>
  </PreviewPaneList>
  <PreviewPaneContent>
    {(value) => (value === "" ? null : <Details id={value} />)}
  </PreviewPaneContent>
</PreviewPane>
```

- `PreviewPane`: the layout and the active value, controlled (`value`,
  `onValueChange`) or not (`defaultValue`). Side by side and top-aligned from
  640px (`sm`), the card below the list under it.
- `usePreviewPane()`: `{ value, bind }`. Spread `bind` (`value`,
  `onValueChange`) onto any list that reports its active item, like cmdk's
  `Command`, when the pane holds the state.
- `PreviewPaneList`: the list's side; takes the room the card leaves.
- `PreviewPaneContent`: the card, rendered from the active value. Return
  `null` for no card. It isn't a live region: the list already announces the
  active item.

Tests: `preview-pane.test.tsx` (keyboard, pointer, controlled, empty,
layout). This package's tests run in Vitest browser mode, like the
composer's.

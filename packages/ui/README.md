# @workspace/ui

The design system: shadcn components on Base UI and the theme
(`src/styles/globals.css`, the only place colours live). Add shadcn
components with the CLI; they're owned source after that.

## AI chat UI: shadcn's AI Elements patterns

shadcn's [AI Elements](https://ui.shadcn.com/docs/ai-elements) aren't a
package: each pattern (Message, Reasoning, Tool, Prompt Input, …) is a
composition of shadcn components that you copy to where it's used. So there
is no wrapper layer here. The primitives live in this package (`trace`,
`code-block`, `message`, `bubble`, `attachment`, `message-scroller`,
`input-group`), and the apps compose them where they render:

| Pattern | Composed in |
|---|---|
| Message | `packages/chat-ui/src/conversation/message-row.tsx`, `packages/library-ui/src/components/test-chat.tsx` |
| Reasoning | `packages/chat-ui/src/conversation/reasoning-part.tsx` |
| Tool | `packages/chat-ui/src/conversation/tool-status.tsx` |
| Prompt Input | `packages/composer/src/components/` (`composer.tsx`, `composer-footer.tsx`, `plus-menu.tsx`) |
| All of them, with sample data | `apps/web/app/dev/ai-elements/demo.tsx` (`ENABLE_DEV_ROUTES=1`) |

The primitives were adapted to our rules on the way in: icons from
`@workspace/icons`, Lingui strings, logical utilities, no height animation
on `trace`'s collapsible (D28), an opacity pulse instead of `shimmer`, and a
24px hit target on `trace`'s trigger. `code-block` came without its Shiki
hook: highlighted code is `@pierre/diffs`' (D16) and chat highlighting is
ticket 143's.

Components we wrote ourselves, because shadcn has nothing equivalent:

## `markdown.tsx`

Model output as markdown, on Streamdown. shadcn's Message pattern renders
replies with Streamdown in a project-owned `markdown` component; ours hands
Streamdown the registry's icons (D19) and Lingui strings (D12), and
re-renders only when the text changes.

## `model-selector.tsx`

The composer's model and agent picker: a searchable dialog (Base UI dialog
and cmdk command) with provider sections, vendor marks from
`@workspace/icons/brands` and a preview card for the highlighted row (094,
099, 105). It began as AI Elements' model selector. shadcn's Model Selector
pattern is a dropdown with no search, so this one stays.

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

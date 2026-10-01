---
id: "105"
title: "Model picker as an overlay next to Send, plainer rows, and a separate variant picker"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["099"]
---

## Question

Connor's feedback on 099's picker (2026-10-01):
- It doesn't need to be attached to the trigger like a dropdown: an overlay, or a dialog, as it was before.
- The model indicator should sit next to the Send button, not the + button.
- Remove the description from the list rows, since the preview card already shows it.
- Normalise the text size: the provider and the model name shouldn't differ in size.
- Separate the **variants** from the model into their own picker. Connor means the reasoning or effort level, like ChatGPT's Thinking switch. Variants fall out of the main list, and there should probably be a variant for fast mode.

## Done when

- **Overlay:** the picker opens as a centred overlay (Base UI Dialog, near the top on small screens so the keyboard doesn't cover the search), with 099's `PreviewPane` beside the list, or below it under 640px. It is keyboard-first: focus starts in the search field, and Escape returns focus to the trigger.
- **Trigger placement:** the model trigger moves to the end of the composer's footer, just before Send/Stop. The context chip and the + menu stay at the start. Check the layout at 375px.
- **Rows:** the 096 description line is removed (search still matches descriptions). Model name and provider use the same text size; the provider differs only by its muted colour.
- **Variants:**
  - **In the list:** catalog entries that are only a mode of another model are folded into that model. Examples are suffixes like `-thinking`, `-reasoning`, `:thinking`, `-fast`, `-instant` and `-high` when the base model exists too. Different models such as `-mini`, `-nano` and sizes are not folded.
  - **The control:** a small separate **variant picker** next to the model trigger, shown only when the chosen model has variants. Its options are **Fast**, **Balanced** and **Deep** for reasoning-capable models. Fast means reasoning off or minimal (or the fast catalog entry when one exists), and Deep means the highest effort the provider offers.
  - **Folded entries:** a folded entry becomes the variant that selects it, so choosing it sends that entry's ref.
  - **Remembering it:** the choice is kept per model and per user, like recents.
- **Sending the level:** sending a level that isn't a separate ref needs an optional `reasoning` field on run options in `packages/contract`. Connor hasn't approved that yet. **Build everything else first. Do NOT change `packages/contract`; stop and report.** Until it's approved, only variants that map to a different ref take effect, and level-only variants are visibly unavailable ("needs server support").
- **Tests:** folding rules (unit), the variant picker's visibility and choice, the overlay's focus behaviour, and the footer order. Update the 099 e2e test for the overlay. Gate and e2e pass.

## Owns

`packages/composer/src/**`, `packages/ui/src/components/ai-elements/model-selector.tsx` and `preview-pane.tsx`, `packages/ai/src/providers/**` (folding variants, if done on the server), `e2e/tests/composer.spec.ts`, `e2e/support/**`.

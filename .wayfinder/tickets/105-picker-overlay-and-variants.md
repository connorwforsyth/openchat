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
- Separate the **variants** from the model into their own picker. Connor means the reasoning or effort level, like ChatGPT's Thinking switch, and variants fall out of the main list. **Fast mode is separate from the thinking level.**

## Done when

- **Overlay:** the picker opens as a centred overlay (Base UI Dialog, near the top on small screens so the keyboard doesn't cover the search), with 099's `PreviewPane` beside the list, or below it under 640px. It is keyboard-first: focus starts in the search field, and Escape returns focus to the trigger.
- **Trigger placement:** the model trigger moves to the end of the composer's footer, just before Send/Stop. The context chip and the + menu stay at the start. Check the layout at 375px.
- **Rows:** the 096 description line is removed (search still matches descriptions). Model name and provider use the same text size; the provider differs only by its muted colour.
- **Thinking level and fast mode (Connor: fast mode is separate from the thinking level):**
  - **Folding the list:** catalog entries that are only a mode of another model fold into that model. Examples are suffixes like `-thinking`, `-reasoning`, `:thinking`, `-high`, `-fast`, `-instant` and `-turbo`, when the base model exists too. Different models such as `-mini`, `-nano` and sizes are not folded.
  - **Thinking level picker:** a small separate control next to the model trigger, shown only for reasoning-capable models. Its levels come from what the provider supports (for example Off / Low / Medium / High). A folded thinking entry becomes the level that selects it.
  - **Fast mode:** a separate switch (in the + menu, next to Web search), shown only when the chosen model has a fast variant (a folded fast entry, or a provider fast tier the catalog reports). It is independent of the thinking level.
  - **Remembering choices:** both are kept per model and per user, like recents.
  - **Contract:** sending a level or fast mode that isn't a separate ref needs optional `reasoning` and `fast` fields on run options in `packages/contract`. Connor hasn't approved that yet. **Build everything else first. Do NOT change `packages/contract`; stop and report.** Until it's approved, only choices that map to a different ref take effect, and the rest show as unavailable ("needs server support").
- **Tests:** folding rules (unit), the variant picker's visibility and choice, the overlay's focus behaviour, and the footer order. Update the 099 e2e test for the overlay. Gate and e2e pass.

## Owns

`packages/composer/src/**`, `packages/ui/src/components/ai-elements/model-selector.tsx` and `preview-pane.tsx`, `packages/ai/src/providers/**` (folding variants, if done on the server), `e2e/tests/composer.spec.ts`, `e2e/support/**`.

## Results (2026-10-01, loop)

Built on `t/105-picker-variants` (from `t/099-model-picker`). Not pushed. No `packages/contract` change.

- **Overlay** (`packages/ui/.../model-selector.tsx`). The picker is a Base UI Dialog again. It's centred horizontally with a fixed top edge: 8vh on a phone, 18vh from 640px. The top edge stays put so the panel doesn't jump while a search shortens the list. The `PreviewPane` card sits beside the list, or below it under 640px. Focus starts in the search, and Escape or a click on the backdrop returns focus to the trigger.
- **Footer.** At the start: the + menu, the Search and Fast chips while they're on, and the context chip. At the end: the thinking control, then the model trigger, then Send/Stop. At 375px the context chip and thinking control are icon-only, and the trigger truncates the model name.
- **Rows.** Each row is one line: logo, name, and the vendor (or an alias's model) at the same size, muted. The 096 description moved to the card only, and search still matches it. Auto's row is just its name.
- **Folding** (`packages/composer/src/variants.ts`). An entry folds into a listed model when it's a ref (aliases never fold), its base is the same ref without the suffix, and that base isn't folded itself.
  - `:thinking`, `-thinking` and `-reasoning` become the level "On".
  - `-high` becomes "High".
  - `-fast`, `-instant` and `-turbo` become fast mode.
  - Examples: `openai:o4-mini-high` becomes o4-mini's High; `openrouter:anthropic/claude-3.7-sonnet:thinking` becomes its On; `gateway:anthropic/claude-opus-5-fast` becomes Opus 5's fast mode.
  - `-mini`, `-nano`, sizes, a mode whose base isn't listed, and a mode under another provider key stay separate rows.
- **Thinking control** (`components/thinking-control.tsx`). It shows when the server says the model reasons, or when the model has a folded thinking entry.
  - Its levels follow the installed AI SDK providers' mapping of the `reasoning` setting (`providerLevels`).
  - Off, Low, Medium and High take effect today. They go out as the model target's existing `parameters.reasoningEffort`, which the server already passes to the AI SDK as `reasoning` (`packages/ai/src/agent/call-settings.ts`).
  - A folded level picks its own entry instead.
  - Minimal, Extra high and Max are listed but disabled, marked "Needs server support".
- **Fast mode.** It's a + menu switch, separate from the thinking level, and picks the folded fast entry. While it's on, folded thinking levels show "Not with Fast mode". A provider's own fast tier (OpenAI priority from GPT-4/o3, Anthropic `speed: fast` on Opus 4.6) shows disabled, marked "Needs server support".
- **Memory.** Both choices are remembered per model in local storage under `recentsKey`.
- **Tests.**
  - composer: 142 (+24).
    - `variants.test.ts`: folding rules, each provider's levels, fast tiers, and the target each choice makes.
    - Picker: overlay focus and modality, one-line rows, folded entries.
    - Composer: footer order, the thinking control's visibility and choices, unavailable levels, fast mode and its chip, and per-model memory.
  - e2e `composer.spec.ts`:
    - The 099 test now checks the overlay is centred with focus in its search.
    - A new 105 test checks the footer order, Low sent as `reasoningEffort`, Fast mode sending `mock:parrot-fast`, and Echo's level being remembered.
    - The mock catalog marks Echo as reasoning and adds `parrot-fast`.
- **Verified.**
  - `bun run check` and guards are clean, and typecheck, lint and build all pass.
  - Under parallel load, a different untouched package's tests failed on each run: importers, db, chat-ui and server. Each passes on its own.
  - `E2E_PORT=3224 bun turbo test:e2e`: 57 passed, 1 failed. The failure is `sidebar.spec` "the conversation keeps 480px". Its `getByRole("button", { name: "Workspace" })` also matches "Workspace actions" once the panel has loaded. That's a timing race, and it also fails on the 099 base when the panel has had time to load.
  - Screenshots are in `/private/tmp/claude-501/105-screens/` (light, dark, 375px; footer, thinking menu, overlay, + menu with Fast mode, Fast on). They were taken from `/dev/composer` with a temporary richer model list, since reverted.

Open:
- Run options for a thinking level and fast mode. The proposed contract diff is in `/private/tmp/claude-501/105-screens/proposed-contract.diff`:
  - `runOptions.reasoning` (off, minimal, low, medium, high, xhigh, max) and `runOptions.fast`;
  - `Run.options`.

  With those, the disabled levels and provider fast tiers can be switched on. The server would map them per provider: `reasoning` through the AI SDK, and fast as `openai.serviceTier: "priority"` or `anthropic.speed: "fast"`.
- The level and fast-tier tables live in the composer, because `ModelOption` has nowhere to carry them. They would be better reported by the server.
- Fast mode uses `ClockIcon`; a `FastIcon` (lucide Zap) in `@workspace/icons` would read better.
- `-highspeed` / `-ultraspeed` gateway ids aren't folded.

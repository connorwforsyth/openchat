---
id: "099"
title: "Model picker: brand logos, bare names, and a preview card with each model's details"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["096"]
---

## Question

Connor (2026-10-01) shared a recording of Raycast AI's model picker as the target, and asked for model logos, names without the vendor prefix (the section already says it), the provider on the right of each row, and the hover preview with the model's metadata, built as a component in our own UI kit.

What the recording shows:
- **A floating panel anchored above the composer** (not a modal), with "Search models…" and an info button.
- **Sections:** Recently used, then one per provider, with a divider between them.
- **Each row:** the provider's logo, the bare model name ("Claude Opus 5", not `anthropic/claude-opus-5`), and the provider muted on the right.
- **A preview card beside the panel** that follows the highlighted row (pointer or arrow keys), showing:
  - the name;
  - Speed, Intelligence and Cost as segmented bars;
  - Context ("150k words | 200k");
  - capabilities with icons: Vision, Tool Use, Supports Reasoning, or a muted "Reasoning unsupported".
  - Provider-setup rows show a sentence instead. A model with no data says so ("No benchmarks for …").

Connor approved (2026-10-01):
- **Contract:** additive optional fields on `ModelOption` for the card.
- **Logos:** vendored monochrome SVG brand marks in `@workspace/icons`, from an MIT-licensed set.

## Done when

- **Contract** (`packages/contract/src/schemas/models.ts`, additive, all optional):
  - `displayName` (the catalog's human name, else derived);
  - `capabilities`, extended or confirmed to cover `vision`, `tools`, `reasoning`;
  - `cost` (a 1–5 tier and, when the price table or catalog knows it, input/output micro-USD per million);
  - `ratings` (`speed`, `intelligence`, 1–5, only from config).
  - `contextWindow` already exists. Old clients keep working; the OpenAPI is regenerated.
- **Server** fills these from the provider catalog (095: name, context window, pricing, tags/capabilities where the catalog has them), the price table (`models.prices`, PR #71, if present on the branch; otherwise the catalog's pricing), provider capabilities, and a new optional config `models.ratings.<alias or ref>: { speed, intelligence }`. Nothing is invented: unknown means absent.
- **Logos:** vendor monochrome SVGs for at least Anthropic, OpenAI, Google, Meta, Mistral, xAI, DeepSeek, Qwen/Alibaba, Cohere, Amazon, Microsoft, Perplexity, Moonshot, Zhipu and NVIDIA. Use `currentColor`, keep the source's licence notice, no network at runtime. The existing letter mark stays as the fallback.
- **The picker** replaces the 094 dialog's presentation with an anchored panel (Base UI Popover + our cmdk `command.tsx`), opening above the trigger, keyboard-first. Escape returns focus.
  - **Sections:** Recently used (the last 3 the person picked, kept per user in local storage, with a fallback when unavailable), Auto if enabled, one per provider, then agents.
  - **Rows:** logo, `displayName` without the vendor prefix, the provider muted on the right; unavailable rows disabled with the reason; the description line from 096 kept.
- **Preview card** — a new reusable `PreviewPane` component in `packages/ui` (a side card anchored to the panel that follows the active item). Base UI's `PreviewCard` is hover-only, so the component tracks the command list's active value instead, so keyboard and pointer both drive it.
  - **Content:** the name; Speed, Intelligence and Cost as segmented 5-step bars (hidden when unknown); Context in words and tokens; Vision, Tool use and Reasoning rows (muted when unsupported); the description. Agents show their own description.
  - **Narrow widths:** under ~640px the card moves below the list instead of beside it.
- **Tests:** server fill and precedence, contract round trip, `PreviewPane` follows the active item by keyboard and pointer, rows show bare names and providers, logos resolve with a fallback. e2e: open, arrow down, the card shows the highlighted model's context; pick and send. Gate and e2e pass.

## Owns

`packages/contract/src/schemas/models.ts` (these fields only), `packages/ai/src/providers/**`, `packages/config/src/schema.ts` (`models.ratings`), `packages/server/src/api/meta.ts`, `packages/icons/**`, `packages/ui/src/components/**` (new `preview-pane`, the vendored model selector), `packages/composer/src/**`, `docs/self-hosting.md`, `e2e/tests/composer.spec.ts`, `e2e/support/**`.

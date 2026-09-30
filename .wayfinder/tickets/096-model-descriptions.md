---
id: "096"
title: "A short description under each model in the picker (needs a contract field)"
labels: [wayfinder:grilling]
status: open
assignee: 
blockedBy: ["094", "095"]
---

## Question

Connor asked (2026-10-01) for a short description under each model so people know why they'd pick it. The picker gets its list from `meta.models`, whose `ModelOption` (`packages/contract/src/schemas/models.ts`) has no description or provider field, so this needs an additive contract change, which waits for Connor's explicit approval.

## Done when

- `ModelOption` gains optional `description` (short, one line) and `provider` (for grouping and the logo); old clients ignore them.
- Descriptions come from, in order: config (`models.descriptions.<alias or ref>`, and `auto` gets a built-in one-liner in the UI strings), then the provider's catalog when discovery ([095](095-model-discovery.md)) returns one.
- The 094 dialog shows them. Tests for precedence and the contract round trip. Gate and e2e pass.

## Owns

`packages/contract/src/schemas/models.ts` (after approval), `packages/ai/src/providers/registry.ts`, `packages/config/src/schema.ts` (descriptions), `packages/composer/src/components/target-picker.tsx`.

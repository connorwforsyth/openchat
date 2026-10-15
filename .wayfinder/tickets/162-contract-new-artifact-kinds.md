---
id: "162"
title: "Contract: `presentation`, `spreadsheet` and `diagram` artifact kinds"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Connor (2026-10-16): "I'd like to have a presentations mode, a spreadsheet mode, a docs mode … and the microsite too. And maybe a flowchart or diagram tool." Docs and sites exist. The other three need values in `artifactKindSchema` (`packages/contract/src/schemas/message-parts.ts`), which the `artifact.kind` column stores.

## Done when

- **Contract PR (touches nothing else):** `artifactKindSchema` gains `presentation`, `spreadsheet` and `diagram`. The PR names who needs them (164, 165, 166) and what breaks: nothing for clients, since the change is additive. It also notes that `builtinKindDefinitions` is typed so every kind needs a definition, so the kit change lands with or before the merge. Connor reviews and merges it; agents never merge it.
- **Follow-up PR:** a migration adds the three values to the `artifact.kind` check, as `20261001193633_sites` did for `site`, with PGlite tests.

## Owns

`packages/contract/src/schemas/message-parts.ts` (own PR), then `packages/db/drizzle/**` and `packages/db/src/schema/**` (the kind check).

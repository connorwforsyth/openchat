---
id: "166"
title: "Spreadsheets: a `spreadsheet` kind with formulas, a grid editor and Excel export"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["162"]
---

## Question

Connor (2026-10-16) wants a spreadsheet mode. The artifact proposal (PR #76) sketched it as JSON of sheets, cells and formulas, with "the formula subset we evaluate". Like documents and diagrams it's a data kind: the model edits through operations, and a trusted grid shows it. Dependencies are MIT only while the licence is undecided (PLAN.md Q12), which rules out HyperFormula (GPL-3.0).

## Done when

- **Content (JSON):** `{ sheets: [{ name, cells: { "A1": { v } | { f, fmt? } }, cols? }] }`.
  - `modelText` shows the model a compact grid of values and formulas, not raw JSON.
  - Operations: `set_range`, `set_formula`, `add_sheet`, `rename_sheet`, `delete_range` and `replace`.
- **Evaluation:** a pure evaluator in the kit. It parses formulas, builds the dependency graph and detects cycles, then calls `@formulajs/formulajs` (MIT) for the functions.
  - The guide lists the supported subset.
  - Checks refuse unknown functions, cycles, references outside the sheets, and anything past the size caps.
- **Grid:** the viewer and editor live in `packages/chat-ui`, on `@glideapps/glide-data-grid` (MIT). A person's edit saves a version through the same checks. Theme tokens only.
- **Export:** `.xlsx` via `exceljs` (MIT), and `.csv`. Importing an attached `.xlsx` or `.csv` is a follow-up.
- **Artifacts page:** a "Spreadsheet" starter card.
- **Tests:** evaluator tests (functions, ranges, cycles), operation and check tests, an `.xlsx` round-trip, browser-mode grid tests, and e2e covering create, a `set_formula` edit and export.

## Owns

`packages/artifacts-kit/src/kinds/spreadsheet/**`, `builtin.ts` and `instance.ts` (registration), `packages/chat-ui/src/artifacts/spreadsheet/**`, `e2e/tests/spreadsheets.spec.ts`.

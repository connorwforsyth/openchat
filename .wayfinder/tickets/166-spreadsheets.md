---
id: "166"
title: "Spreadsheets: a `spreadsheet` kind with formulas, a grid editor and Excel export"
labels: [wayfinder:build]
status: open
assignee: loop
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

## Results (2026-10-16)

- **Kind** (`packages/artifacts-kit/src/kinds/spreadsheet/`): the content is JSON `{ sheets: [{ name, cells: { A1: { v } | { f, fmt? } }, cols? }] }`. `modelText` shows each sheet as a labelled Markdown table under `## Sheet: <name>`, with every formula followed by its result (`=SUM(B2:B3) → 1600`). Going the other way it accepts that same grid, a plain table starting at A1, CSV, or the JSON. The operations are `set_range`, `set_formula` (given a range, it fills it and moves relative references), `add_sheet`, `rename_sheet` (formulas follow the new name), `delete_range` and `replace`. Starter card: "Spreadsheet", with a `new` badge. It replaces 162's `spreadsheet` placeholder; `presentation` and `diagram` are unchanged.
- **Evaluator** (pure):
  - It has its own recursive-descent parser and builds a dependency graph between formula cells.
  - It evaluates in topological order (Kahn's algorithm), so chains of thousands of cells don't recurse, and it reports the cells on a cycle by themselves.
  - IF, IFERROR, IFNA, ISERROR and ISNA are evaluated lazily by the kit; about 90 other deterministic functions come from `@formulajs/formulajs` through named imports.
  - The checks refuse unknown functions, cycles, missing sheets, references past A–CV × 10,000, and anything over the caps: 20 sheets, 50k cells, 100k cells per range, 2M characters. Duplicate sheet names are refused too.
  - The guide (the kind's instructions) lists the supported subset.
- **update_artifact**: the flat `edit` object gains `range`, `sheet`, `values`, `formula`, `fmt` and `name`, and its operation enum now includes the spreadsheet edits. `create_artifact` offers `spreadsheet`.
- **Grid** (`packages/chat-ui/src/artifacts/spreadsheet/`):
  - It uses Glide Data Grid, lazy-loaded and client-only. The theme reads tokens from computed style and resolves them to hex through a 1×1 canvas, so there are no colour literals; it re-themes when `<html>`'s class changes.
  - It has a formula bar, sheet tabs and Add sheet.
  - A person's edit goes through the kit's operations and checks before it's kept, and is then saved through the documents' save hook and API. The server checks it again.
  - Read-only for viewers and for older versions; Restore works.
- **Export**: `.xlsx` through exceljs, with formulas, cached results, number formats and column widths. `.csv` writes the active sheet's computed values, with formula-like text defused.
- **Tests**:
  - Kit: evaluator, operations, checks, and an `.xlsx` round trip.
  - Browser mode: the grid, including typing into a cell.
  - `e2e/tests/spreadsheets.spec.ts`: create, `set_formula`, a refused function, a person's edit, and both exports. It passes locally.
  - Snapshots updated: artifact golden, sandbox tool golden, server instructions.
- **Outside Owns, kept small**: `define.ts` (the `grid` editor and the `spreadsheet` panel), `artifact-view.tsx` (routing), `artifact-full-view.tsx` and `chat-screen.tsx` (treat spreadsheets like documents), `model/artifacts.ts`, `kind-icon.tsx` (LayoutGridIcon), `document-view.tsx` (exported SaveStatus and OlderVersion), `format.ts`, `create-artifact.ts` and `update-artifact.ts`.
- **Gaps**:
  - No date functions: formulajs returns local-time JS Dates.
  - Number formats render only the common subset; others are passed to Excel as written.
  - Replacing the whole sheet from the model's grid text drops `fmt` and `cols`. Edits keep them.
  - There's no rename-sheet or column-resize UI yet.
  - Importing `.xlsx`/`.csv` is a follow-up; `spreadsheetFromXlsx` exists for the round-trip test.

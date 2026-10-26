import { sizeLimit } from "../../checks";
import { defineArtifactKind } from "../../define";
import { spreadsheetSize, uniqueSheetNames, validFormulas } from "./checks";
import { SPREADSHEET_FUNCTION_GROUPS } from "./functions";
import { spreadsheetFromModel, spreadsheetToModel } from "./grid-text";
import {
  addSheet,
  deleteRange,
  renameSheet,
  replaceSpreadsheet,
  setFormula,
  setRange,
} from "./operations";
import {
  SPREADSHEET_LIMITS,
  type Spreadsheet,
  serializeSpreadsheet,
  spreadsheetContentSchema,
} from "./schema";

// The Spreadsheet kind (166): sheets of values and formulas a person edits
// in a grid and the model edits a range at a time. A version stores JSON
// (`schema.ts`); the model reads and writes a grid of Markdown tables
// (`grid-text.ts`). Formulas are computed by the kit's own evaluator, with
// formulajs for the functions, so every viewer agrees on the numbers.

const functionList = Object.entries(SPREADSHEET_FUNCTION_GROUPS)
  .map(([group, names]) => `${group}: ${names.join(", ")}`)
  .map((line) => `- ${line}`)
  .join("\n");

/** What the model is told about spreadsheets, after the artifacts fragment. */
export const SPREADSHEET_INSTRUCTIONS = `Spreadsheets (create_artifact type "spreadsheet") are sheets of values and formulas the user can edit in a grid and export to Excel (.xlsx) or CSV. Use one for budgets, trackers, comparisons, schedules, calculations and any table someone will sort, change or reuse; use a Markdown table in the reply for a small table that's only read.

Write a spreadsheet's content as one Markdown table per sheet, each under a heading "## Sheet: <name>". The table's first row is row 1 (put column titles there), its first column is column A:

## Sheet: Budget
| Item | Cost | Share |
| Rent | 1200 | =B2/B$4 |
| Food | 400 | =B3/B$4 |
| Total | =SUM(B2:B3) | |

A cell starting with = is a formula, numbers and TRUE/FALSE are values, and anything else is text (start it with ' to keep text that looks like a number). Escape a | inside a cell as \\|. Formulas use Excel's syntax: A1 and $A$1 references, ranges like B2:B9 (not whole columns like B:B), other sheets as Sheet2!A1 or 'My sheet'!A1, the operators + - * / ^ & = <> < > <= >= and %. Only these functions are supported; anything else is refused:
${functionList}

When you read a spreadsheet you see each sheet labelled with column letters and row numbers, and each formula followed by what it computes: \`=SUM(B2:B3) → 1600\`. You can send that labelled form back too; only the formula before → is kept.

To change part of a spreadsheet, call update_artifact with \`edit\` instead of \`content\`:
- set_range: \`values\` (rows of cells) written from the top-left of \`range\`; null clears a cell. Optional \`fmt\` sets a number format ("0.00", "#,##0", "0%", "$#,##0.00").
- set_formula: \`formula\` in the cell \`range\`; for a range, it's written for the top-left cell and copied across, relative references moving ($ keeps one fixed).
- delete_range: clears \`range\`.
- add_sheet: a new empty sheet called \`name\`. rename_sheet: \`sheet\` gets \`name\`.
Edits act on \`sheet\`, or the first sheet without one. Send the whole \`content\` only to rebuild most of it. A spreadsheet holds at most ${SPREADSHEET_LIMITS.sheets} sheets and ${SPREADSHEET_LIMITS.cells} filled cells, in columns A to CV and rows 1 to ${SPREADSHEET_LIMITS.rows}; formulas that don't parse, refer to sheets that don't exist or refer to themselves are refused. The user may have edited it since you wrote it: edit the latest version you were shown.`;

export const spreadsheetKind = defineArtifactKind<Spreadsheet>({
  capabilities: {
    aiCalls: false,
    annotate: false,
    present: false,
    share: false,
  },
  checks: [
    sizeLimit({ chars: SPREADSHEET_LIMITS.chars, of: serializeSpreadsheet }),
    spreadsheetSize,
    uniqueSheetNames,
    validFormulas,
  ],
  content: spreadsheetContentSchema,
  diff: "text",
  editor: "grid",
  export: [
    { extension: "xlsx", format: "file" },
    { extension: "csv", format: "file" },
  ],
  icon: "SheetIcon",
  instructions: SPREADSHEET_INSTRUCTIONS,
  kind: "spreadsheet",
  label: "Spreadsheet",
  modelText: {
    fromModel: spreadsheetFromModel,
    serialize: serializeSpreadsheet,
    toModel: spreadsheetToModel,
  },
  operations: {
    add_sheet: addSheet,
    delete_range: deleteRange,
    rename_sheet: renameSheet,
    replace: replaceSpreadsheet,
    set_formula: setFormula,
    set_range: setRange,
  },
  render: { panel: "spreadsheet", runtime: null },
  starter: { badge: "new" },
  thumbnail: "none",
});

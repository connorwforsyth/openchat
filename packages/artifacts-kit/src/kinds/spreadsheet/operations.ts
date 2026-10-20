import { z } from "zod";

import { defineOperation } from "../../define";
import { renameSheetIn, shiftFormula } from "./formula";
import { cellFromLiteral, spreadsheetFromModel } from "./grid-text";
import {
  type Cell,
  cellValueInputSchema,
  EMPTY_SPREADSHEET,
  findSheet,
  isFormulaCell,
  parseAddress,
  type Sheet,
  SPREADSHEET_LIMITS,
  type Spreadsheet,
  toAddress,
} from "./schema";

// How the model (or the grid) changes a spreadsheet without sending all of
// it (166): values into a range, a formula into a cell (or copied across a
// range, its relative references moving as Excel's fill does), a sheet
// added or renamed, a range cleared, or the whole thing replaced. Each is
// pure; `problems` says why one can't apply before `apply` runs. The kind's
// checks then hold the result to the caps and the formula rules.

export interface Area {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** `B2` or `B2:D5` (either corner first) as an area; `null` when it's neither. */
export const parseRange = (range: string): Area | null => {
  const [first = "", second, extra] = range.replaceAll("$", "").split(":");
  if (extra !== undefined) {
    return null;
  }
  const start = parseAddress(first);
  const end = second === undefined ? start : parseAddress(second);
  if (!(start && end)) {
    return null;
  }
  return {
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.col, end.col),
    right: Math.max(start.col, end.col),
    top: Math.min(start.row, end.row),
  };
};

const sheetInput = z
  .string()
  .trim()
  .min(1)
  .max(SPREADSHEET_LIMITS.sheetName)
  .describe("The sheet's name; left out, the first sheet.");

const rangeInput = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .describe('A cell ("B2") or a range ("B2:D5").');

const fmtInput = z
  .string()
  .min(1)
  .max(64)
  .describe('A number format: "0.00", "#,##0", "0%", "$#,##0.00".');

const sheetNames = (spreadsheet: Spreadsheet) =>
  spreadsheet.sheets.map((sheet) => `"${sheet.name}"`).join(", ");

const noSheet = (spreadsheet: Spreadsheet, name: string | undefined) =>
  `there's no sheet called "${name ?? ""}". Its sheets: ${sheetNames(spreadsheet)}`;

const badRange = (range: string) =>
  `"${range}" isn't a cell or range like B2 or B2:D5`;

const outside = (area: Area) =>
  area.right >= SPREADSHEET_LIMITS.columns ||
  area.bottom >= SPREADSHEET_LIMITS.rows
    ? [
        `the range reaches past the sheet's ${SPREADSHEET_LIMITS.columns} columns or ${SPREADSHEET_LIMITS.rows} rows`,
      ]
    : [];

/** `spreadsheet` with the sheet called `name` changed by `change`. */
const withSheet = (
  spreadsheet: Spreadsheet,
  name: string | undefined,
  change: (sheet: Sheet) => Sheet
): Spreadsheet => {
  const target = findSheet(spreadsheet, name);
  return {
    ...spreadsheet,
    sheets: spreadsheet.sheets.map((sheet) =>
      sheet === target ? change(sheet) : sheet
    ),
  };
};

const withCells = (
  sheet: Sheet,
  changes: ReadonlyMap<string, Cell | null>
): Sheet => {
  const cells: Record<string, Cell> = { ...sheet.cells };
  for (const [address, cell] of changes) {
    if (cell) {
      cells[address] = cell;
    } else {
      delete cells[address];
    }
  }
  return { ...sheet, cells };
};

const sheetProblems = (
  current: Spreadsheet | null,
  sheet: string | undefined
): string[] => {
  const spreadsheet = current ?? EMPTY_SPREADSHEET;
  return findSheet(spreadsheet, sheet) ? [] : [noSheet(spreadsheet, sheet)];
};

const valuesInput = z
  .array(
    z
      .array(z.union([cellValueInputSchema, z.null()]))
      .max(SPREADSHEET_LIMITS.columns)
  )
  .min(1)
  .max(SPREADSHEET_LIMITS.rows)
  .describe(
    'Rows of cells, starting at the range\'s top-left: numbers, TRUE/FALSE, text, "=FORMULA", or null to clear one.'
  );

/** Values (and formulas) into a block of cells, from its top-left. */
export const setRange = defineOperation({
  apply: (
    current: Spreadsheet | null,
    input: {
      readonly fmt?: string;
      readonly range: string;
      readonly sheet?: string;
      readonly values: readonly (readonly (CellLiteral | null)[])[];
    }
  ) => {
    const area = parseRange(input.range);
    const spreadsheet = current ?? EMPTY_SPREADSHEET;
    if (!area) {
      return spreadsheet;
    }
    const changes = new Map<string, Cell | null>();
    for (const [row, line] of input.values.entries()) {
      for (const [col, literal] of line.entries()) {
        changes.set(
          toAddress(area.left + col, area.top + row),
          cellFromLiteral(literal, input.fmt)
        );
      }
    }
    return withSheet(spreadsheet, input.sheet, (sheet) =>
      withCells(sheet, changes)
    );
  },
  description:
    "Write rows of values into cells, starting at the range's top-left cell. Text starting with = is a formula; null clears a cell.",
  input: z.object({
    fmt: fmtInput.optional(),
    range: rangeInput,
    sheet: sheetInput.optional(),
    values: valuesInput,
  }),
  problems: (current, input) => {
    const area = parseRange(input.range);
    if (!area) {
      return [badRange(input.range)];
    }
    const rows = input.values.length;
    const cols = Math.max(...input.values.map((line) => line.length));
    const covered = {
      ...area,
      bottom: area.top + rows - 1,
      right: area.left + cols - 1,
    };
    const single = area.left === area.right && area.top === area.bottom;
    const fits =
      single ||
      (covered.bottom === area.bottom && covered.right === area.right);
    return [
      ...sheetProblems(current, input.sheet),
      ...(fits
        ? []
        : [
            `the values are ${rows} rows by ${cols} columns, which doesn't fill ${input.range}; give just its top-left cell to write any size`,
          ]),
      ...outside(covered),
    ];
  },
});

type CellLiteral = z.infer<typeof cellValueInputSchema>;

const LEADING_EQUALS = /^\s*=/;

/** The formula for every cell of an area, copied from its top-left. */
const filled = (
  area: Area,
  formula: string
): { readonly cells: Map<string, string>; readonly problem: string | null } => {
  const cells = new Map<string, string>();
  for (let row = area.top; row <= area.bottom; row += 1) {
    for (let col = area.left; col <= area.right; col += 1) {
      const shifted = shiftFormula(formula, col - area.left, row - area.top);
      if (!shifted.ok) {
        return { cells, problem: shifted.error };
      }
      cells.set(toAddress(col, row), shifted.value);
    }
  }
  return { cells, problem: null };
};

/** A formula into a cell, or copied across a range from its top-left. */
export const setFormula = defineOperation({
  apply: (
    current: Spreadsheet | null,
    input: {
      readonly fmt?: string;
      readonly formula: string;
      readonly range: string;
      readonly sheet?: string;
    }
  ) => {
    const spreadsheet = current ?? EMPTY_SPREADSHEET;
    const area = parseRange(input.range);
    if (!area) {
      return spreadsheet;
    }
    const { cells } = filled(area, input.formula.replace(LEADING_EQUALS, ""));
    const changes = new Map<string, Cell | null>(
      [...cells].map(([address, f]) => [
        address,
        { f, ...(input.fmt === undefined ? {} : { fmt: input.fmt }) },
      ])
    );
    return withSheet(spreadsheet, input.sheet, (sheet) =>
      withCells(sheet, changes)
    );
  },
  description:
    "Put a formula in a cell. Given a range, the formula is written for its top-left cell and copied across the range, relative references moving as Excel's fill does ($ keeps one fixed).",
  input: z.object({
    fmt: fmtInput.optional(),
    formula: z
      .string()
      .trim()
      .min(1)
      .max(SPREADSHEET_LIMITS.formulaChars)
      .describe('The formula, with or without its leading "=": "SUM(B2:B9)".'),
    range: rangeInput,
    sheet: sheetInput.optional(),
  }),
  problems: (current, input) => {
    const area = parseRange(input.range);
    if (!area) {
      return [badRange(input.range)];
    }
    const { problem } = filled(area, input.formula.replace(LEADING_EQUALS, ""));
    return [
      ...sheetProblems(current, input.sheet),
      ...outside(area),
      ...(problem ? [problem] : []),
    ];
  },
});

/** Clears a block of cells. */
export const deleteRange = defineOperation({
  apply: (
    current: Spreadsheet | null,
    input: { readonly range: string; readonly sheet?: string }
  ) => {
    const spreadsheet = current ?? EMPTY_SPREADSHEET;
    const area = parseRange(input.range);
    if (!area) {
      return spreadsheet;
    }
    return withSheet(spreadsheet, input.sheet, (sheet) => ({
      ...sheet,
      cells: Object.fromEntries(
        Object.entries(sheet.cells).filter(([address]) => {
          const at = parseAddress(address);
          return !(
            at &&
            at.col >= area.left &&
            at.col <= area.right &&
            at.row >= area.top &&
            at.row <= area.bottom
          );
        })
      ),
    }));
  },
  description:
    "Clear the cells in a range (formulas that read them see blanks).",
  input: z.object({ range: rangeInput, sheet: sheetInput.optional() }),
  problems: (current, input) =>
    parseRange(input.range)
      ? sheetProblems(current, input.sheet)
      : [badRange(input.range)],
});

const nameTaken = (spreadsheet: Spreadsheet, name: string) =>
  findSheet(spreadsheet, name)
    ? [`there's already a sheet called "${name}"`]
    : [];

/** A new, empty sheet at the end. */
export const addSheet = defineOperation({
  apply: (current: Spreadsheet | null, input: { readonly name: string }) => {
    const spreadsheet = current ?? EMPTY_SPREADSHEET;
    return {
      ...spreadsheet,
      sheets: [...spreadsheet.sheets, { cells: {}, name: input.name }],
    };
  },
  description: "Add an empty sheet after the others.",
  input: z.object({
    name: sheetInput.describe("The new sheet's name."),
  }),
  problems: (current, input) =>
    nameTaken(current ?? EMPTY_SPREADSHEET, input.name),
});

/** A sheet's new name; formulas that name it follow. */
export const renameSheet = defineOperation({
  apply: (
    current: Spreadsheet | null,
    input: { readonly name: string; readonly sheet?: string }
  ) => {
    const spreadsheet = current ?? EMPTY_SPREADSHEET;
    const target = findSheet(spreadsheet, input.sheet);
    if (!target) {
      return spreadsheet;
    }
    return {
      ...spreadsheet,
      sheets: spreadsheet.sheets.map((sheet) => ({
        ...sheet,
        cells: Object.fromEntries(
          Object.entries(sheet.cells).map(([address, cell]) => [
            address,
            isFormulaCell(cell)
              ? { ...cell, f: renameSheetIn(cell.f, target.name, input.name) }
              : cell,
          ])
        ),
        name: sheet === target ? input.name : sheet.name,
      })),
    };
  },
  description: "Rename a sheet; formulas that refer to it by name follow.",
  input: z.object({
    name: sheetInput.describe("The sheet's new name."),
    sheet: sheetInput.optional(),
  }),
  problems: (current, input) => {
    const spreadsheet = current ?? EMPTY_SPREADSHEET;
    const target = findSheet(spreadsheet, input.sheet);
    if (!target) {
      return [noSheet(spreadsheet, input.sheet)];
    }
    const other = findSheet(spreadsheet, input.name);
    return other && other !== target ? nameTaken(spreadsheet, input.name) : [];
  },
});

/** The whole spreadsheet again, from the model's grid text. */
export const replaceSpreadsheet = defineOperation({
  apply: (_current: Spreadsheet | null, input: { readonly content: string }) =>
    spreadsheetFromModel(input.content),
  description:
    "Replace the whole spreadsheet: one Markdown table per sheet under ## Sheet: <name>.",
  input: z.object({ content: z.string().min(1).max(2_000_000) }),
});

/** The structured edits the model may make, by the name it calls them. */
export const SPREADSHEET_EDITS = {
  add_sheet: addSheet,
  delete_range: deleteRange,
  rename_sheet: renameSheet,
  set_formula: setFormula,
  set_range: setRange,
} as const;

export type SpreadsheetEditName = keyof typeof SPREADSHEET_EDITS;

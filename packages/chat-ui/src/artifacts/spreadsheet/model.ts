import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type { Evaluated } from "@workspace/artifacts-kit/kinds/spreadsheet/evaluate";
import { formatValue } from "@workspace/artifacts-kit/kinds/spreadsheet/format";
import { cellToText } from "@workspace/artifacts-kit/kinds/spreadsheet/grid-text";
import {
  columnLetters,
  type Sheet,
  SPREADSHEET_LIMITS,
  type Spreadsheet,
  sheetExtent,
  spreadsheetContentSchema,
} from "@workspace/artifacts-kit/kinds/spreadsheet/schema";
import { err, ok, type Result } from "@workspace/shared/result";

// The grid's model (166), pure: what each cell shows and holds for editing,
// how big the grid is drawn, and a person's edit as the next version's
// text. Edits go through the kit's own operations and checks, the same the
// model's edits and the server's save go through, so the grid can't save
// what the server would refuse.

/** A version's text as a spreadsheet; `null` when it doesn't read as one. */
export const readSpreadsheet = (content: string): Spreadsheet | null => {
  const parsed = spreadsheetContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
};

/** Spare columns and rows past the last used cell, to type into. */
const SPARE = { cols: 4, rows: 30 } as const;
const MIN = { cols: 12, rows: 60 } as const;

/** How many columns and rows the grid draws for `sheet`. */
export const gridSize = (
  sheet: Sheet
): { readonly cols: number; readonly rows: number } => {
  const extent = sheetExtent(sheet);
  return {
    cols: Math.min(
      SPREADSHEET_LIMITS.columns,
      Math.max(MIN.cols, extent.cols + SPARE.cols)
    ),
    rows: Math.min(
      SPREADSHEET_LIMITS.rows,
      Math.max(MIN.rows, extent.rows + SPARE.rows)
    ),
  };
};

/** A column's width in pixels: its own, or the default. */
export const columnWidth = (sheet: Sheet, col: number): number =>
  sheet.cols?.[columnLetters(col)]?.width ?? 112;

export interface CellView {
  /** What the cell shows: its value, formatted. */
  readonly display: string;
  /** What editing it starts from: `=` and the formula, or the value. */
  readonly edit: string;
  readonly isError: boolean;
  readonly isNumber: boolean;
}

const EMPTY_CELL: CellView = {
  display: "",
  edit: "",
  isError: false,
  isNumber: false,
};

/** One cell of `sheet` (index `sheetIndex` in `evaluated`), for the grid. */
export const cellView = (
  sheet: Sheet,
  evaluated: Evaluated,
  sheetIndex: number,
  address: string,
  locale: string
): CellView => {
  const cell = sheet.cells[address];
  if (!cell) {
    return EMPTY_CELL;
  }
  const value = evaluated.sheets[sheetIndex]?.values[address] ?? null;
  return {
    display: formatValue(value, cell.fmt, locale),
    edit: cellToText(cell),
    isError: typeof value === "object" && value !== null,
    isNumber: typeof value === "number",
  };
};

/** One cell a person typed into, by address. */
export interface CellEdit {
  readonly address: string;
  readonly text: string;
}

/**
 * The next version's text after a person's edits on sheet `sheetName`:
 * each a `set_range` of one cell, keeping the cell's number format. The
 * result has passed the kind's checks; otherwise, what they say. Pure.
 */
export const editCells = (
  stored: string,
  sheetName: string,
  edits: readonly CellEdit[]
): Result<string, readonly string[]> => {
  let next = stored;
  for (const { address, text } of edits) {
    const sheet = readSpreadsheet(next)?.sheets.find(
      (each) => each.name === sheetName
    );
    const fmt = sheet?.cells[address]?.fmt;
    const edited = builtinArtifactKinds.edit("spreadsheet", next, "set_range", {
      range: address,
      sheet: sheetName,
      values: [[text.trim() === "" ? null : text]],
      ...(fmt === undefined ? {} : { fmt }),
    });
    if (!edited.ok) {
      return edited;
    }
    next = edited.value;
  }
  return checked(next);
};

const checked = (next: string): Result<string, readonly string[]> => {
  const problems = builtinArtifactKinds.check("spreadsheet", next);
  return problems.length > 0 ? err(problems) : ok(next);
};

/** A name for a new sheet: `Sheet<n>`, the first `n` not taken. */
export const nextSheetName = (spreadsheet: Spreadsheet): string => {
  const taken = new Set(
    spreadsheet.sheets.map((sheet) => sheet.name.toLowerCase())
  );
  let number = spreadsheet.sheets.length + 1;
  while (taken.has(`sheet${number}`)) {
    number += 1;
  }
  return `Sheet${number}`;
};

/** The next version's text with a new, empty sheet called `name`. Pure. */
export const addSheet = (
  stored: string,
  name: string
): Result<string, readonly string[]> => {
  const edited = builtinArtifactKinds.edit("spreadsheet", stored, "add_sheet", {
    name,
  });
  return edited.ok ? checked(edited.value) : edited;
};

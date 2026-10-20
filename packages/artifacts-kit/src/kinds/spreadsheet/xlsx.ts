import ExcelJS from "exceljs";

import {
  type ComputedValue,
  evaluateSpreadsheet,
  isCellError,
} from "./evaluate";
import { cellFromText } from "./grid-text";
import {
  type Cell,
  columnLetters,
  isFormulaCell,
  type Sheet,
  type Spreadsheet,
} from "./schema";

// Excel files (166), through `exceljs` (MIT): the adapter, so its classes
// stay here. Out, every sheet with its formulas, each with the value we
// computed as its cached result (so a viewer that doesn't recalculate
// still shows numbers), number formats and column widths. In is for the
// round trip and for importing an attached file later (a follow-up).

/** Excel's column width is in characters; ours is in pixels. */
const PIXELS_PER_CHARACTER = 7;

type ExcelValue = ExcelJS.CellValue;

const excelError = (value: ComputedValue): ExcelJS.CellErrorValue["error"] => {
  if (!isCellError(value)) {
    return "#VALUE!";
  }
  // Excel has no cycle error: it shows the reference error for one.
  return value.error === "#CYCLE!" ? "#REF!" : value.error;
};

const resultOf = (value: ComputedValue): ExcelJS.CellFormulaValue["result"] => {
  if (value === null) {
    return undefined;
  }
  if (isCellError(value)) {
    return { error: excelError(value) };
  }
  return value;
};

const excelValue = (cell: Cell, computed: ComputedValue): ExcelValue =>
  isFormulaCell(cell)
    ? { formula: cell.f, result: resultOf(computed) }
    : cell.v;

/** The workbook, as the bytes of an .xlsx file. */
export const spreadsheetToXlsx = async (
  spreadsheet: Spreadsheet
): Promise<Uint8Array> => {
  const evaluated = evaluateSpreadsheet(spreadsheet);
  const workbook = new ExcelJS.Workbook();
  for (const [index, sheet] of spreadsheet.sheets.entries()) {
    const values = evaluated.sheets[index]?.values ?? {};
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const [letters, column] of Object.entries(sheet.cols ?? {})) {
      if (column.width !== undefined) {
        worksheet.getColumn(letters).width =
          column.width / PIXELS_PER_CHARACTER;
      }
    }
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const target = worksheet.getCell(address);
      target.value = excelValue(cell, values[address] ?? null);
      if (cell.fmt !== undefined) {
        target.numFmt = cell.fmt;
      }
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
};

/** A cell read from Excel; `null` for one that's empty or we can't keep. */
const cellOf = (cell: ExcelJS.Cell): Cell | null => {
  const fmt =
    cell.numFmt && cell.numFmt !== "General" ? cell.numFmt : undefined;
  const withFmt = fmt === undefined ? {} : { fmt };
  const { value } = cell;
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { v: value, ...withFmt };
  }
  if (typeof value === "string") {
    return value === "" ? null : { v: value, ...withFmt };
  }
  if (value instanceof Date) {
    return { v: value.toISOString(), ...withFmt };
  }
  if ("formula" in value && typeof value.formula === "string") {
    return { f: value.formula, ...withFmt };
  }
  if ("richText" in value) {
    return cellFromText(value.richText.map((run) => run.text).join(""), fmt);
  }
  if ("text" in value && typeof value.text === "string") {
    return { v: value.text, ...withFmt };
  }
  return null;
};

/** An .xlsx file's sheets, with formulas (their cached results dropped). */
export const spreadsheetFromXlsx = async (
  bytes: Uint8Array
): Promise<Spreadsheet> => {
  const workbook = new ExcelJS.Workbook();
  // exceljs's types want Node's Buffer; it reads any ArrayBuffer view.
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheets: Sheet[] = workbook.worksheets.map((worksheet) => {
    const cells: Record<string, Cell> = {};
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const read = cellOf(cell);
        if (read) {
          cells[cell.address] = read;
        }
      });
    });
    const cols: Record<string, { width: number }> = {};
    worksheet.columns.forEach((column, index) => {
      if (column.width !== undefined) {
        cols[columnLetters(index)] = {
          width: Math.round(column.width * PIXELS_PER_CHARACTER),
        };
      }
    });
    return {
      cells,
      name: worksheet.name,
      ...(Object.keys(cols).length > 0 ? { cols } : {}),
    };
  });
  return {
    sheets: sheets.length > 0 ? sheets : [{ cells: {}, name: "Sheet1" }],
  };
};

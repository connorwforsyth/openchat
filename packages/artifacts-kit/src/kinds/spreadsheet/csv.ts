import {
  type ComputedValue,
  evaluateSpreadsheet,
  isCellError,
  numberText,
} from "./evaluate";
import { type Spreadsheet, sheetExtent, toAddress } from "./schema";

// CSV (166), RFC 4180: what a spreadsheet exports for one sheet (the
// computed values, not the formulas), and what the model may write instead
// of a table. Pure.

const NEEDS_QUOTES = /[",\r\n]/;
/** Text a spreadsheet app would run as a formula when it opens the file. */
const FORMULA_LIKE = /^[=+\-@\t\r]/;

const field = (value: ComputedValue): string => {
  if (value === null) {
    return "";
  }
  if (isCellError(value)) {
    return value.error;
  }
  if (typeof value === "number") {
    return numberText(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  // OWASP's advice on CSV injection: text that would read as a formula
  // gets a leading quote, so opening the file doesn't run it.
  const text = FORMULA_LIKE.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Rows of values as CSV, lines ending CRLF as the RFC has it. */
export const toCsv = (rows: readonly (readonly ComputedValue[])[]): string =>
  rows.map((row) => row.map(field).join(",")).join("\r\n") +
  (rows.length > 0 ? "\r\n" : "");

/** One sheet's computed values as CSV, from A1 to its last used cell. */
export const sheetToCsv = (spreadsheet: Spreadsheet, index = 0): string => {
  const sheet = spreadsheet.sheets[index];
  if (!sheet) {
    return "";
  }
  const values = evaluateSpreadsheet(spreadsheet).sheets[index]?.values ?? {};
  const { cols, rows } = sheetExtent(sheet);
  return toCsv(
    Array.from({ length: rows }, (_line, row) =>
      Array.from(
        { length: cols },
        (_cell, col) => values[toAddress(col, row)] ?? null
      )
    )
  );
};

/** CSV (or, with `delimiter` "\t", TSV) as rows of fields. */
export const parseCsv = (
  text: string,
  delimiter = ","
): readonly (readonly string[])[] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let index = 0;
  const endField = () => {
    row.push(value);
    value = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        value += '"';
        index += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"' && value === "") {
      quoted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      value += char;
    }
    index += 1;
  }
  if (value !== "" || row.length > 0) {
    endRow();
  }
  return rows;
};

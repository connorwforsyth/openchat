import { parseCsv } from "./csv";
import {
  type ComputedValue,
  evaluateSpreadsheet,
  isCellError,
  numberText,
} from "./evaluate";
import {
  type Cell,
  type CellLiteral,
  columnLetters,
  EMPTY_SPREADSHEET,
  isFormulaCell,
  parseAddress,
  type Sheet,
  type Spreadsheet,
  sheetExtent,
  toAddress,
} from "./schema";

// What the model reads and writes of a spreadsheet (166): not the stored
// JSON but a grid, one Markdown table per sheet under `## Sheet: <name>`.
// The model reads it labelled, with column letters and row numbers, and
// each formula followed by what it computes (`=SUM(B2:B3) → 1200`). It may
// write the same, or a plain table whose first row is row 1, or CSV; the
// stored JSON is accepted too. Pure.

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const RESULT_ARROW = " → ";

/**
 * What typing `text` into a cell makes: a formula when it starts with `=`,
 * a number, TRUE or FALSE, or text (a leading `'` keeps it text, as in
 * Excel); `null` for nothing.
 */
export const cellFromText = (text: string, fmt?: string): Cell | null => {
  const withFmt = fmt === undefined ? {} : { fmt };
  if (text.startsWith("'")) {
    return { v: text.slice(1), ...withFmt };
  }
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  if (trimmed.startsWith("=") && trimmed.length > 1) {
    return { f: trimmed.slice(1).trim(), ...withFmt };
  }
  if (NUMERIC.test(trimmed)) {
    return { v: Number(trimmed), ...withFmt };
  }
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") {
    return { v: upper === "TRUE", ...withFmt };
  }
  return { v: text, ...withFmt };
};

/** A literal (from JSON or an edit) as a cell: strings are read as typed. */
export const cellFromLiteral = (
  literal: CellLiteral | null,
  fmt?: string
): Cell | null => {
  if (literal === null) {
    return null;
  }
  return typeof literal === "string"
    ? cellFromText(literal, fmt)
    : { v: literal, ...(fmt === undefined ? {} : { fmt }) };
};

/** A cell as someone would type it back: `=` before a formula, `'` before text that would read as something else. */
export const cellToText = (cell: Cell): string => {
  if (isFormulaCell(cell)) {
    return `=${cell.f}`;
  }
  const { v } = cell;
  if (typeof v === "number") {
    return numberText(v);
  }
  if (typeof v === "boolean") {
    return v ? "TRUE" : "FALSE";
  }
  const typed = cellFromText(v);
  return typed && !isFormulaCell(typed) && typed.v === v ? v : `'${v}`;
};

/** A computed value as the grid text shows it. */
export const valueText = (value: ComputedValue): string => {
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
  return value;
};

const escapeCell = (text: string): string =>
  text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "\\n");

const sheetToModel = (
  sheet: Sheet,
  values: Readonly<Record<string, ComputedValue>>
): string => {
  const heading = `## Sheet: ${sheet.name}`;
  const { cols, rows } = sheetExtent(sheet);
  if (cols === 0) {
    return `${heading}\n\n(empty)`;
  }
  const letters = Array.from({ length: cols }, (_, col) => columnLetters(col));
  const lines = [
    `|   | ${letters.join(" | ")} |`,
    `|---|${letters.map(() => "---").join("|")}|`,
  ];
  for (let row = 0; row < rows; row += 1) {
    const cells = letters.map((_, col) => {
      const address = toAddress(col, row);
      const cell = sheet.cells[address];
      if (!cell) {
        return "";
      }
      const text = cellToText(cell);
      return escapeCell(
        isFormulaCell(cell)
          ? `${text}${RESULT_ARROW}${valueText(values[address] ?? null)}`
          : text
      );
    });
    if (cells.some((each) => each !== "")) {
      lines.push(`| ${row + 1} | ${cells.join(" | ")} |`);
    }
  }
  return `${heading}\n\n${lines.join("\n")}`;
};

/** The labelled grid of every sheet, with computed values beside formulas. */
export const spreadsheetToModel = (spreadsheet: Spreadsheet): string => {
  const evaluated = evaluateSpreadsheet(spreadsheet);
  return spreadsheet.sheets
    .map((sheet, index) =>
      sheetToModel(sheet, evaluated.sheets[index]?.values ?? {})
    )
    .join("\n\n");
};

const HEADING = /^#{1,6}\s+(?:sheet:\s*)?(.+?)\s*$/i;
const SEPARATOR = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LETTERS = /^[A-Z]{1,3}$/;
const ROW_NUMBER = /^[1-9]\d*$/;

const LEADING_PIPE = /^\|/;
const TRAILING_PIPE = /(?<!\\)\|$/;

/** A table row's cells: split on unescaped pipes, then unescaped. */
const splitRow = (line: string): string[] => {
  const inner = line
    .trim()
    .replace(LEADING_PIPE, "")
    .replace(TRAILING_PIPE, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner.charAt(index);
    if (char === "\\" && index + 1 < inner.length) {
      const next = inner.charAt(index + 1);
      current += next === "n" ? "\n" : next;
      index += 1;
    } else if (char === "|") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

/** A written cell: a formula loses the `→ value` it was shown with. */
const writtenCell = (text: string): Cell | null => {
  const arrow = text.startsWith("=") ? text.lastIndexOf(RESULT_ARROW) : -1;
  return cellFromText(arrow > 0 ? text.slice(0, arrow) : text);
};

const isLabelled = (first: readonly string[]): boolean =>
  first.length > 1 &&
  first[0] === "" &&
  first.slice(1).every((cell) => LETTERS.test(cell));

/** Rows labelled with column letters and row numbers, as the model reads them. */
const labelledCells = (
  rows: readonly (readonly string[])[]
): Record<string, Cell> => {
  const [first = []] = rows;
  const columns = first
    .slice(1)
    .map((letters) => parseAddress(`${letters}1`)?.col);
  const cells: Record<string, Cell> = {};
  for (const [number = "", ...rest] of rows.slice(1)) {
    const row = ROW_NUMBER.test(number) ? Number(number) - 1 : -1;
    for (const [index, text] of rest.entries()) {
      const col = columns[index];
      const cell = writtenCell(text);
      if (row >= 0 && col !== undefined && cell) {
        cells[toAddress(col, row)] = cell;
      }
    }
  }
  return cells;
};

const cellsOfRows = (
  rows: readonly (readonly string[])[]
): Record<string, Cell> => {
  if (isLabelled(rows[0] ?? [])) {
    return labelledCells(rows);
  }
  const cells: Record<string, Cell> = {};
  for (const [row, line] of rows.entries()) {
    for (const [col, text] of line.entries()) {
      const cell = writtenCell(text);
      if (cell) {
        cells[toAddress(col, row)] = cell;
      }
    }
  }
  return cells;
};

const sheetFromLines = (name: string, lines: readonly string[]): Sheet => {
  const table = lines.filter((line) => line.trim().startsWith("|"));
  if (table.length > 0) {
    return {
      cells: cellsOfRows(
        table.filter((line) => !SEPARATOR.test(line)).map(splitRow)
      ),
      name,
    };
  }
  const body = lines
    .filter((line) => line.trim() !== "" && line.trim() !== "(empty)")
    .join("\n");
  return {
    cells: cellsOfRows(parseCsv(body, body.includes("\t") ? "\t" : ",")),
    name,
  };
};

/**
 * The model's text as a spreadsheet: the stored JSON, or a grid of
 * Markdown tables (or CSV) under `## Sheet: <name>` headings.
 */
export const spreadsheetFromModel = (text: string): Spreadsheet => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      // Whatever it holds, the kind's schema says what's wrong with it.
      return JSON.parse(trimmed) as Spreadsheet;
    } catch {
      // Not JSON after all: read it as a grid.
    }
  }
  const sections: { lines: string[]; name: string | null }[] = [];
  let current: { lines: string[]; name: string | null } = {
    lines: [],
    name: null,
  };
  for (const line of trimmed.split("\n")) {
    const heading = HEADING.exec(line.trim());
    if (heading) {
      if (current.name !== null || current.lines.some((each) => each.trim())) {
        sections.push(current);
      }
      current = { lines: [], name: (heading[1] ?? "").trim() };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  const sheets = sections
    .filter(
      (section) =>
        section.name !== null || section.lines.some((each) => each.trim())
    )
    .map((section, index) =>
      sheetFromLines(section.name ?? `Sheet${index + 1}`, section.lines)
    );
  return sheets.length > 0 ? { sheets } : EMPTY_SPREADSHEET;
};

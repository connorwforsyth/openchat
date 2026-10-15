import type { ArtifactCheck } from "../../define";
import { analyzeSpreadsheet } from "./evaluate";
import {
  parseAddress,
  SPREADSHEET_LIMITS,
  type Spreadsheet,
  toAddress,
} from "./schema";

// A spreadsheet's rules beyond its shape (166): it fits the caps, its
// sheets have different names, and every formula parses, calls only the
// supported functions, refers to cells that exist, and doesn't reach
// itself. Each problem is a sentence the model can act on.

const LAST_COLUMN = toAddress(SPREADSHEET_LIMITS.columns - 1, 0).slice(0, -1);

/** Caps on sheets, cells, and the grid's size. */
export const spreadsheetSize: ArtifactCheck<Spreadsheet> = {
  name: "size",
  run: (spreadsheet) => {
    const problems: string[] = [];
    if (spreadsheet.sheets.length > SPREADSHEET_LIMITS.sheets) {
      problems.push(
        `a spreadsheet has at most ${SPREADSHEET_LIMITS.sheets} sheets; this one has ${spreadsheet.sheets.length}`
      );
    }
    const cells = spreadsheet.sheets.reduce(
      (total, sheet) => total + Object.keys(sheet.cells).length,
      0
    );
    if (cells > SPREADSHEET_LIMITS.cells) {
      problems.push(
        `a spreadsheet has at most ${SPREADSHEET_LIMITS.cells} filled cells; this one has ${cells}`
      );
    }
    for (const sheet of spreadsheet.sheets) {
      const beyond = Object.keys(sheet.cells).find((address) => {
        const at = parseAddress(address);
        return (
          !at ||
          at.col >= SPREADSHEET_LIMITS.columns ||
          at.row >= SPREADSHEET_LIMITS.rows
        );
      });
      if (beyond) {
        problems.push(
          `${sheet.name}!${beyond} is outside the sheet: columns A to ${LAST_COLUMN}, rows 1 to ${SPREADSHEET_LIMITS.rows}`
        );
      }
    }
    return problems;
  },
};

/** Sheet names are different (ignoring case), as formulas name them. */
export const uniqueSheetNames: ArtifactCheck<Spreadsheet> = {
  name: "sheet-names",
  run: (spreadsheet) => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const sheet of spreadsheet.sheets) {
      const key = sheet.name.toLowerCase();
      if (seen.has(key)) {
        repeated.add(sheet.name);
      }
      seen.add(key);
    }
    return [...repeated].map(
      (name) => `two sheets are called "${name}"; give each its own name`
    );
  },
};

/** Every formula parses, uses the supported functions, and has no cycle. */
export const validFormulas: ArtifactCheck<Spreadsheet> = {
  name: "formulas",
  run: (spreadsheet) => analyzeSpreadsheet(spreadsheet).slice(0, 20),
};

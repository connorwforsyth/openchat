import { z } from "zod";

// A spreadsheet's content (166): sheets of cells keyed by A1 address. A cell
// holds a value (`v`) or a formula (`f`, without its leading `=`), and
// either may carry a number format (`fmt`, Excel's syntax). Computed values
// aren't stored: the evaluator (`evaluate.ts`) derives them, so a version
// can't disagree with itself.
//
// A version stores the JSON as text; `spreadsheetContentSchema` reads it.

/** The caps every version is held to (`checks.ts` reports them). */
export const SPREADSHEET_LIMITS = {
  /** Cells with something in them, across every sheet. */
  cells: 50_000,
  /** Longest stored spreadsheet, as JSON. */
  chars: 2_000_000,
  /** Columns a sheet may use: A to CV. */
  columns: 100,
  formulaChars: 2000,
  /** Cells one range may cover (`SUM(A1:CV1000)`). */
  rangeCells: 100_000,
  rows: 10_000,
  sheetName: 64,
  sheets: 20,
  textChars: 10_000,
} as const;

const ADDRESS = /^([A-Z]{1,3})([1-9]\d{0,6})$/;

/** `A1` as a zero-based column and row; `null` when it isn't one. */
export const parseAddress = (
  address: string
): { readonly col: number; readonly row: number } | null => {
  const match = ADDRESS.exec(address.trim().toUpperCase());
  if (!match) {
    return null;
  }
  const [, letters = "", digits = ""] = match;
  let col = 0;
  for (const letter of letters) {
    col = col * 26 + (letter.charCodeAt(0) - 64);
  }
  return { col: col - 1, row: Number(digits) - 1 };
};

/** A zero-based column as its letters: 0 is `A`, 26 is `AA`. */
export const columnLetters = (col: number): string => {
  let letters = "";
  let rest = col + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
};

/** A zero-based column and row as an address: (0, 0) is `A1`. */
export const toAddress = (col: number, row: number): string =>
  `${columnLetters(col)}${row + 1}`;

const formatSchema = z
  .string()
  .min(1)
  .max(64)
  .describe('A number format, as Excel writes one: "0.00", "#,##0", "0%".');

export const cellValueInputSchema = z.union([
  z.string().max(SPREADSHEET_LIMITS.textChars),
  z.number().refine(Number.isFinite, "isn't a finite number"),
  z.boolean(),
]);
/** What a person or the model can type into a cell. */
export type CellLiteral = z.infer<typeof cellValueInputSchema>;

export const valueCellSchema = z.strictObject({
  fmt: formatSchema.optional(),
  v: cellValueInputSchema,
});

export const formulaCellSchema = z.strictObject({
  f: z
    .string()
    .min(1)
    .max(SPREADSHEET_LIMITS.formulaChars)
    .describe("The formula without its leading =."),
  fmt: formatSchema.optional(),
});

export const cellSchema = z.union([valueCellSchema, formulaCellSchema]);
export type Cell = z.infer<typeof cellSchema>;

export const isFormulaCell = (
  cell: Cell
): cell is z.infer<typeof formulaCellSchema> => "f" in cell;

const addressKey = z
  .string()
  .refine((key) => parseAddress(key) !== null && key === key.toUpperCase(), {
    message: "isn't a cell address like A1",
  });

export const columnSchema = z.strictObject({
  width: z.int().min(24).max(800).optional(),
});

export const sheetSchema = z.strictObject({
  cells: z.record(addressKey, cellSchema),
  /** Column settings by letter (`"A"`). */
  cols: z.record(z.string().regex(/^[A-Z]{1,3}$/), columnSchema).optional(),
  name: z.string().trim().min(1).max(SPREADSHEET_LIMITS.sheetName),
});
export type Sheet = z.infer<typeof sheetSchema>;

export const spreadsheetSchema = z.strictObject({
  sheets: z.array(sheetSchema).min(1),
});
export type Spreadsheet = z.infer<typeof spreadsheetSchema>;

/** A new spreadsheet: one empty sheet. */
export const EMPTY_SPREADSHEET: Spreadsheet = {
  sheets: [{ cells: {}, name: "Sheet1" }],
};

/**
 * A version's stored text, read as a spreadsheet: JSON, then the shape. Bad
 * JSON is one issue, not a stack.
 */
export const spreadsheetContentSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: "isn't a spreadsheet's JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(spreadsheetSchema);

/** A spreadsheet as a version stores it. */
export const serializeSpreadsheet = (spreadsheet: Spreadsheet): string =>
  JSON.stringify(spreadsheet);

/** The sheet called `name` (ignoring case), or the first when `name` is left out. */
export const findSheet = (
  spreadsheet: Spreadsheet,
  name: string | undefined
): Sheet | undefined =>
  name === undefined
    ? spreadsheet.sheets[0]
    : spreadsheet.sheets.find(
        (sheet) => sheet.name.toLowerCase() === name.trim().toLowerCase()
      );

/** The cells' extent: one past the last used column and row. */
export const sheetExtent = (
  sheet: Sheet
): { readonly cols: number; readonly rows: number } => {
  let cols = 0;
  let rows = 0;
  for (const key of Object.keys(sheet.cells)) {
    const at = parseAddress(key);
    if (at) {
      cols = Math.max(cols, at.col + 1);
      rows = Math.max(rows, at.row + 1);
    }
  }
  return { cols, rows };
};

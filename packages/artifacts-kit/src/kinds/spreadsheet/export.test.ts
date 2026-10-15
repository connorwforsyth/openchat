import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseCsv, sheetToCsv } from "./csv";
import { formatValue } from "./format";
import type { Spreadsheet } from "./schema";
import { spreadsheetFromXlsx, spreadsheetToXlsx } from "./xlsx";

// Out of the app (166): Excel files through exceljs, read back to prove the
// round trip; CSV of one sheet's computed values; and number formats.

const workbook: Spreadsheet = {
  sheets: [
    {
      cells: {
        A1: { v: "Item" },
        A2: { v: "Rent" },
        A3: { v: "Food" },
        B1: { v: "Cost" },
        B2: { fmt: "$#,##0.00", v: 1200 },
        B3: { v: 400.5 },
        B4: { f: "SUM(B2:B3)", fmt: "#,##0.0" },
        C1: { v: true },
        C2: { f: "B2/0" },
      },
      cols: { A: { width: 140 } },
      name: "Budget",
    },
    { cells: { A1: { f: "Budget!B4*2" } }, name: "Other sheet" },
  ],
};

describe("spreadsheetToXlsx", () => {
  it("round-trips sheets, values, formulas, formats and widths", async () => {
    const bytes = await spreadsheetToXlsx(workbook);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(await spreadsheetFromXlsx(bytes)).toEqual(workbook);
  });

  it("caches the computed results, so a viewer that doesn't recalculate shows them", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(
      (await spreadsheetToXlsx(workbook)) as unknown as ArrayBuffer
    );
    const sheet = book.getWorksheet("Budget");
    expect(sheet?.getCell("B4").value).toEqual({
      formula: "SUM(B2:B3)",
      result: 1600.5,
    });
    expect(sheet?.getCell("C2").value).toEqual({
      formula: "B2/0",
      result: { error: "#DIV/0!" },
    });
    expect(book.getWorksheet("Other sheet")?.getCell("A1").value).toEqual({
      formula: "Budget!B4*2",
      result: 3201,
    });
  });
});

describe("sheetToCsv", () => {
  it("writes one sheet's computed values, quoted as RFC 4180 has it", () => {
    expect(sheetToCsv(workbook)).toBe(
      "Item,Cost,TRUE\r\nRent,1200,#DIV/0!\r\nFood,400.5,\r\n,1600.5,\r\n"
    );
    expect(sheetToCsv(workbook, 1)).toBe("3201\r\n");
  });

  it("quotes commas and quotes, and defuses text that would run as a formula", () => {
    const csv = sheetToCsv({
      sheets: [
        {
          cells: { A1: { v: 'say "hi", then' }, B1: { v: "=HYPERLINK()" } },
          name: "S",
        },
      ],
    });
    expect(csv).toBe(`"say ""hi"", then",'=HYPERLINK()\r\n`);
    expect(parseCsv(csv)).toEqual([['say "hi", then', "'=HYPERLINK()"]]);
  });
});

describe("formatValue", () => {
  it("shows the common number formats", () => {
    expect(formatValue(1234.5, "#,##0.00")).toBe("1,234.50");
    expect(formatValue(-1234.5, "$#,##0")).toBe("-$1,235");
    expect(formatValue(0.256, "0.0%")).toBe("25.6%");
    expect(formatValue(3, '0.0 "kg"')).toBe("3.0 kg");
    expect(formatValue(0.1 + 0.2, undefined)).toBe("0.3");
    expect(formatValue({ error: "#N/A" }, "0")).toBe("#N/A");
    expect(formatValue("text", "0.00")).toBe("text");
    expect(formatValue(null, "0")).toBe("");
  });
});

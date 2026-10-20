import { describe, expect, it } from "vitest";

import { analyzeSpreadsheet, evaluateSpreadsheet } from "./evaluate";
import { parseFormula, renameSheetIn, shiftFormula } from "./formula";
import type { Cell, Spreadsheet } from "./schema";

// The evaluator (166): the parser, functions through formulajs, ranges,
// errors, sheets, and cycles found by the dependency graph.

const sheet = (
  cells: Readonly<Record<string, Cell>>,
  name = "Sheet1"
): Spreadsheet => ({ sheets: [{ cells, name }] });

const valuesOf = (spreadsheet: Spreadsheet, index = 0) =>
  evaluateSpreadsheet(spreadsheet).sheets[index]?.values ?? {};

const one = (formula: string, cells: Readonly<Record<string, Cell>> = {}) =>
  valuesOf(sheet({ ...cells, Z1: { f: formula } })).Z1;

describe("parseFormula", () => {
  it("parses operators by precedence, references and calls", () => {
    expect(one("1+2*3")).toBe(7);
    expect(one("(1+2)*3")).toBe(9);
    expect(one("2^3^2")).toBe(64);
    expect(one("-2^2")).toBe(4);
    expect(one("50%")).toBe(0.5);
    expect(one('"a"&"b"&1')).toBe("ab1");
    expect(one('"say ""hi"""')).toBe('say "hi"');
    expect(one("1<2")).toBe(true);
    expect(one('"abc"="ABC"')).toBe(true);
    expect(one("2<>2")).toBe(false);
  });

  it("says why a formula doesn't parse", () => {
    expect(parseFormula("SUM(1,2")).toEqual({
      error: "SUM( is missing its closing )",
      ok: false,
    });
    expect(parseFormula("A:A").ok).toBe(false);
    expect(parseFormula("foo").ok).toBe(false);
    expect(parseFormula('"open').ok).toBe(false);
    expect(parseFormula("1 +").ok).toBe(false);
    expect(parseFormula("").ok).toBe(false);
  });

  it("copies a formula with its relative references moved", () => {
    expect(shiftFormula("=A1+$B$1+$C2+D$3", 1, 2)).toEqual({
      ok: true,
      value: "B3+$B$1+$C4+E$3",
    });
    expect(shiftFormula("SUM(Data!A1:A3)", 0, 1)).toEqual({
      ok: true,
      value: "SUM(Data!A2:A4)",
    });
    expect(shiftFormula("A1", -1, 0).ok).toBe(false);
  });

  it("follows a renamed sheet", () => {
    expect(renameSheetIn("Data!A1+'Old one'!B2+C3", "old one", "New")).toBe(
      "Data!A1+New!B2+C3"
    );
    expect(renameSheetIn("Data!A1", "Data", "My data")).toBe("'My data'!A1");
  });
});

describe("evaluateSpreadsheet", () => {
  const budget = sheet({
    A1: { v: "Item" },
    A2: { v: "Rent" },
    A3: { v: "Food" },
    A4: { v: "Total" },
    B1: { v: "Cost" },
    B2: { v: 1200 },
    B3: { v: 400 },
    B4: { f: "SUM(B2:B3)" },
    C2: { f: "B2/B$4" },
    C3: { f: "B3/$B$4" },
  });

  it("computes formulas over ranges, after the cells they read", () => {
    const values = valuesOf(budget);
    expect(values.B4).toBe(1600);
    expect(values.C2).toBe(0.75);
    expect(values.C3).toBe(0.25);
    expect(values.A1).toBe("Item");
  });

  it("calls formulajs's functions, the subset the guide lists", () => {
    const cells: Record<string, Cell> = {
      A1: { v: 3 },
      A2: { v: 1 },
      A3: { v: 2 },
      B1: { v: "x" },
      B2: { v: "y" },
      B3: { v: "x" },
    };
    expect(one("AVERAGE(A1:A3)", cells)).toBe(2);
    expect(one("MAX(A1:A3)-MIN(A1:A3)", cells)).toBe(2);
    expect(one('COUNTIF(B1:B3,"x")', cells)).toBe(2);
    expect(one('SUMIF(B1:B3,"x",A1:A3)', cells)).toBe(5);
    expect(one('VLOOKUP("y",B1:B3,1,FALSE)', cells)).toBe("y");
    expect(one("INDEX(A1:A3,MATCH(2,A1:A3,0))", cells)).toBe(2);
    expect(one("ROUND(2.345,2)")).toBe(2.35);
    expect(one('UPPER(LEFT("hello",2))')).toBe("HE");
    expect(one('TEXTJOIN("-",TRUE,B1:B3)', cells)).toBe("x-y-x");
    expect(one("ROUND(PMT(0.05/12,12,-1000),2)")).toBe(85.61);
    expect(one("AND(A1>2,OR(FALSE,TRUE))", cells)).toBe(true);
  });

  it("treats an empty cell as 0 or empty text", () => {
    expect(one("A1+1")).toBe(1);
    expect(one('A1&"x"')).toBe("x");
    expect(one("ISBLANK(A1)")).toBe(true);
    expect(one('A1=""')).toBe(true);
  });

  it("turns failures into Excel's errors, passed along", () => {
    expect(one("1/0")).toEqual({ error: "#DIV/0!" });
    expect(one('1+"x"')).toEqual({ error: "#VALUE!" });
    expect(one("A1*2", { A1: { f: "1/0" } })).toEqual({ error: "#DIV/0!" });
    expect(one('IFERROR(1/0,"none")')).toBe("none");
    expect(one("ISERROR(1/0)")).toBe(true);
    expect(one("Nope!A1")).toEqual({ error: "#REF!" });
    expect(one("RAND()")).toEqual({ error: "#NAME?" });
    expect(one("SQRT(-1)")).toEqual({ error: "#NUM!" });
  });

  it("computes only the branch IF takes", () => {
    expect(one("IF(TRUE,1,1/0)")).toBe(1);
    expect(one("IF(FALSE,1)")).toBe(false);
  });

  it("reads other sheets by name", () => {
    const values = valuesOf(
      {
        sheets: [
          { cells: { A1: { f: "'My data'!B2*2" } }, name: "Summary" },
          { cells: { B2: { v: 21 } }, name: "My data" },
        ],
      },
      0
    );
    expect(values.A1).toBe(42);
  });

  it("marks cells on a cycle, and their readers", () => {
    const values = valuesOf(
      sheet({ A1: { f: "B1+1" }, B1: { f: "A1+1" }, C1: { f: "A1" } })
    );
    expect(values.A1).toEqual({ error: "#CYCLE!" });
    expect(values.C1).toEqual({ error: "#CYCLE!" });
  });

  it("computes a long chain without running out of stack", () => {
    const cells: Record<string, Cell> = { A1: { v: 0 } };
    for (let row = 2; row <= 5000; row += 1) {
      cells[`A${row}`] = { f: `A${row - 1}+1` };
    }
    expect(valuesOf(sheet(cells)).A5000).toBe(4999);
  });
});

describe("analyzeSpreadsheet", () => {
  it("passes a sound spreadsheet", () => {
    expect(
      analyzeSpreadsheet(sheet({ A1: { v: 1 }, A2: { f: "A1*2" } }))
    ).toEqual([]);
  });

  it("names cycles, unknown functions, missing sheets, bad syntax and refs past the grid", () => {
    expect(
      analyzeSpreadsheet(
        sheet({
          A1: { f: "B1" },
          B1: { f: "A1" },
          C1: { f: "FOO(1)" },
          D1: { f: "Other!A1" },
          E1: { f: "SUM(1," },
          F1: { f: "ZZ1" },
          G1: { f: "A1:CV2000" },
        })
      )
    ).toEqual([
      "C1: FOO isn't a supported function. Use one the spreadsheet guide lists",
      'D1: Other!A1 refers to a sheet "Other" that doesn\'t exist',
      'E1: the formula "=SUM(1," doesn\'t parse: the formula ends too soon',
      "F1: ZZ1 is outside the sheet (columns A to CV, rows 1 to 10000)",
      "G1: the range A1:CV2000 covers more than 100000 cells",
      "these formulas refer to themselves, through each other: A1, B1. Break the cycle",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { builtinArtifactKinds } from "../../builtin";
import { SPREADSHEET_FUNCTIONS } from "./functions";
import { cellFromText, cellToText, spreadsheetFromModel } from "./grid-text";
import { spreadsheetKind } from "./kind";
import { type Spreadsheet, serializeSpreadsheet } from "./schema";

// The Spreadsheet kind through the registry, as the server and the tools
// use it: the model's grid in, JSON stored, the labelled grid back, the
// checks, and the structured edits.

const BUDGET = `## Sheet: Budget
| Item | Cost |
|------|------|
| Rent | 1200 |
| Food | 400 |
| Total | =SUM(B2:B3) |`;

const stored = builtinArtifactKinds.fromModel("spreadsheet", BUDGET);
const read = (text: string): Spreadsheet => JSON.parse(text) as Spreadsheet;
const edit = (
  operation: string,
  input: unknown,
  from: string | null = stored
) => builtinArtifactKinds.edit("spreadsheet", from, operation, input);
const editedCells = (operation: string, input: unknown, sheet = 0) => {
  const result = edit(operation, input);
  if (!result.ok) {
    throw new Error(result.error.join("; "));
  }
  return read(result.value).sheets[sheet]?.cells;
};

describe("the spreadsheet kind", () => {
  it("is a built-in kind, edited in the grid, exported to Excel and CSV, with a starter card", () => {
    expect(builtinArtifactKinds.get("spreadsheet")).toBe(spreadsheetKind);
    expect(spreadsheetKind.editor).toBe("grid");
    expect(spreadsheetKind.render.panel).toBe("spreadsheet");
    expect(spreadsheetKind.export.map((each) => each.extension)).toEqual([
      "xlsx",
      "csv",
    ]);
    expect(spreadsheetKind.starter).toBeDefined();
  });

  it("lists every supported function in its guide", () => {
    for (const name of SPREADSHEET_FUNCTIONS) {
      expect(spreadsheetKind.instructions).toContain(name);
    }
  });

  it("stores the model's tables as JSON, and shows them back as a labelled grid with results", () => {
    expect(read(stored)).toEqual({
      sheets: [
        {
          cells: {
            A1: { v: "Item" },
            A2: { v: "Rent" },
            A3: { v: "Food" },
            A4: { v: "Total" },
            B1: { v: "Cost" },
            B2: { v: 1200 },
            B3: { v: 400 },
            B4: { f: "SUM(B2:B3)" },
          },
          name: "Budget",
        },
      ],
    });
    expect(builtinArtifactKinds.check("spreadsheet", stored)).toEqual([]);
    const shown = builtinArtifactKinds.toModel("spreadsheet", stored);
    expect(shown).toBe(`## Sheet: Budget

|   | A | B |
|---|---|---|
| 1 | Item | Cost |
| 2 | Rent | 1200 |
| 3 | Food | 400 |
| 4 | Total | =SUM(B2:B3) → 1600 |`);
    // What the model reads, it can send back unchanged.
    expect(builtinArtifactKinds.fromModel("spreadsheet", shown)).toBe(stored);
  });

  it("takes the stored JSON, CSV, and several sheets", () => {
    expect(builtinArtifactKinds.fromModel("spreadsheet", stored)).toBe(stored);
    expect(spreadsheetFromModel('a,b\n1,"x, y"').sheets[0]?.cells).toEqual({
      A1: { v: "a" },
      A2: { v: 1 },
      B1: { v: "b" },
      B2: { v: "x, y" },
    });
    const two = spreadsheetFromModel(
      "## Sheet: One\n| 1 |\n\n## Sheet: Two\n| =One!A1*2 |"
    );
    expect(two.sheets.map((sheet) => sheet.name)).toEqual(["One", "Two"]);
  });

  it("reads typed text as Excel does, and writes it back the same", () => {
    expect(cellFromText("=a1+1")).toEqual({ f: "a1+1" });
    expect(cellFromText("12.5")).toEqual({ v: 12.5 });
    expect(cellFromText("true")).toEqual({ v: true });
    expect(cellFromText("'0042")).toEqual({ v: "0042" });
    expect(cellFromText("  ")).toBeNull();
    expect(cellToText({ v: "0042" })).toBe("'0042");
    expect(cellToText({ v: "plain" })).toBe("plain");
    expect(cellToText({ f: "SUM(A1:A2)" })).toBe("=SUM(A1:A2)");
  });

  it("escapes pipes and new lines in the grid", () => {
    const text = serializeSpreadsheet({
      sheets: [{ cells: { A1: { v: "a|b\nc" } }, name: "S" }],
    });
    const shown = builtinArtifactKinds.toModel("spreadsheet", text);
    expect(shown).toContain("| 1 | a\\|b\\nc |");
    expect(builtinArtifactKinds.fromModel("spreadsheet", shown)).toBe(text);
  });
});

describe("checks", () => {
  const check = (spreadsheet: unknown) =>
    builtinArtifactKinds.check("spreadsheet", JSON.stringify(spreadsheet));

  it("refuses text that isn't a spreadsheet, and a spreadsheet of the wrong shape", () => {
    expect(builtinArtifactKinds.check("spreadsheet", "nope")).toEqual([
      "content isn't a spreadsheet's JSON",
    ]);
    expect(check({ sheets: [] })).toHaveLength(1);
    expect(
      check({ sheets: [{ cells: { a1: { v: 1 } }, name: "S" }] })
    ).toHaveLength(1);
  });

  it("refuses unknown functions, cycles and missing sheets", () => {
    expect(
      check({
        sheets: [
          {
            cells: {
              A1: { f: "B1" },
              B1: { f: "A1" },
              C1: { f: "WEBSERVICE(1)" },
              D1: { f: "Gone!A1" },
            },
            name: "S",
          },
        ],
      })
    ).toEqual([
      "C1: WEBSERVICE isn't a supported function. Use one the spreadsheet guide lists",
      'D1: Gone!A1 refers to a sheet "Gone" that doesn\'t exist',
      "these formulas refer to themselves, through each other: A1, B1. Break the cycle",
    ]);
  });

  it("holds a spreadsheet to its caps", () => {
    expect(
      check({
        sheets: Array.from({ length: 21 }, (_, index) => ({
          cells: {},
          name: `S${index}`,
        })),
      })
    ).toEqual(["a spreadsheet has at most 20 sheets; this one has 21"]);
    expect(
      check({ sheets: [{ cells: { CW1: { v: 1 } }, name: "S" }] })
    ).toEqual(["S!CW1 is outside the sheet: columns A to CV, rows 1 to 10000"]);
    const cells = Object.fromEntries(
      Array.from({ length: 50_001 }, (_, index) => [`A${index + 1}`, { v: 1 }])
    );
    expect(check({ sheets: [{ cells, name: "S" }] })).toContain(
      "S!A10001 is outside the sheet: columns A to CV, rows 1 to 10000"
    );
    expect(check({ sheets: [{ cells, name: "S" }] })).toContain(
      "a spreadsheet has at most 50000 filled cells; this one has 50001"
    );
  });

  it("refuses two sheets with one name", () => {
    expect(
      check({
        sheets: [
          { cells: {}, name: "Data" },
          { cells: {}, name: "data" },
        ],
      })
    ).toEqual(['two sheets are called "data"; give each its own name']);
  });
});

describe("edits", () => {
  it("set_range writes rows from the top-left, formulas and all, and clears with null", () => {
    expect(
      editedCells("set_range", {
        range: "C1",
        values: [["Share"], ["=B2/B$4", null]],
      })
    ).toMatchObject({ C1: { v: "Share" }, C2: { f: "B2/B$4" } });
    expect(
      editedCells("set_range", { range: "A2", values: [[null, null]] })?.A2
    ).toBeUndefined();
    expect(
      editedCells("set_range", {
        fmt: "$#,##0",
        range: "B2:B3",
        values: [[1], [2]],
      })?.B2
    ).toEqual({ fmt: "$#,##0", v: 1 });
  });

  it("set_range says when the values don't fill the range, or the sheet isn't there", () => {
    expect(edit("set_range", { range: "A1:B2", values: [[1]] })).toEqual({
      error: [
        "the values are 1 rows by 1 columns, which doesn't fill A1:B2; give just its top-left cell to write any size",
      ],
      ok: false,
    });
    expect(
      edit("set_range", { range: "A1", sheet: "Nope", values: [[1]] })
    ).toEqual({
      error: ['there\'s no sheet called "Nope". Its sheets: "Budget"'],
      ok: false,
    });
    expect(edit("set_range", { range: "11", values: [[1]] }).ok).toBe(false);
  });

  it("set_formula copies a formula across a range, as Excel's fill does", () => {
    const cells = editedCells("set_formula", {
      formula: "=B2/$B$4",
      range: "C2:C3",
    });
    expect(cells?.C2).toEqual({ f: "B2/$B$4" });
    expect(cells?.C3).toEqual({ f: "B3/$B$4" });
  });

  it("delete_range clears cells", () => {
    const cells = editedCells("delete_range", { range: "A2:B3" });
    expect(Object.keys(cells ?? {}).sort()).toEqual(["A1", "A4", "B1", "B4"]);
  });

  it("add_sheet and rename_sheet, with formulas following the new name", () => {
    const added = edit("add_sheet", { name: "Notes" });
    expect(added.ok && read(added.value).sheets.map((s) => s.name)).toEqual([
      "Budget",
      "Notes",
    ]);
    expect(edit("add_sheet", { name: "budget" })).toEqual({
      error: ['there\'s already a sheet called "budget"'],
      ok: false,
    });
    const linked = builtinArtifactKinds.fromModel(
      "spreadsheet",
      "## Sheet: Data\n| 5 |\n\n## Sheet: Sum\n| =Data!A1*2 |"
    );
    const renamed = edit(
      "rename_sheet",
      { name: "Raw data", sheet: "Data" },
      linked
    );
    expect(renamed.ok && read(renamed.value).sheets[1]?.cells.A1).toEqual({
      f: "'Raw data'!A1*2",
    });
  });

  it("replace rebuilds it from the grid", () => {
    const replaced = edit("replace", { content: "| 1 | 2 |" });
    expect(replaced.ok && read(replaced.value).sheets).toEqual([
      { cells: { A1: { v: 1 }, B1: { v: 2 } }, name: "Sheet1" },
    ]);
  });

  it("an edit that makes a cycle is refused by the checks", () => {
    const cyclic = edit("set_formula", { formula: "B4", range: "B2" });
    expect(cyclic.ok).toBe(true);
    expect(
      cyclic.ok && builtinArtifactKinds.check("spreadsheet", cyclic.value)
    ).toEqual([
      "these formulas refer to themselves, through each other: B2, B4. Break the cycle",
    ]);
  });
});

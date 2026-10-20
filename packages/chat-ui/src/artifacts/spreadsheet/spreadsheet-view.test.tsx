import { cleanup, screen, waitFor } from "@testing-library/react";
import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type { Spreadsheet } from "@workspace/artifacts-kit/kinds/spreadsheet/schema";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../../testing/render";
import { addSheet, editCells, gridSize, nextSheetName } from "./model";
import { SpreadsheetView, type SpreadsheetViewProps } from "./spreadsheet-view";
import { gridTheme, readGridTokens, toHex } from "./theme";

// The Spreadsheet grid (166): the model's sheets drawn by Glide in the
// theme's tokens, a formula bar for the selected cell, a person's edit
// checked by the kind's rules and saved as a version after a pause, and
// read only for a viewer and for an older version.

// The grid's chunk, warmed under hookTimeout (ticket 037). On a fresh, busy
// Vite server its first load took 2 to 5.5 s, inside the first test's wait.
beforeAll(async () => {
  await import("./spreadsheet-grid");
});

afterEach(cleanup);

const conversationId = fixtureId("conversation", 1);
const messageId = fixtureId("message", 1);

const budget: Artifact = {
  conversationId,
  createdAt: "2026-10-16T09:00:00.000Z",
  id: fixtureId("artifact", 1),
  kind: "spreadsheet",
  latestVersionId: fixtureId("artifactVersion", 2),
  messageId,
  ownerId: fixtureId("user", 1),
  title: "Budget",
  updatedAt: "2026-10-16T09:05:00.000Z",
};

const GRID = `## Sheet: Costs
| Item | Cost |
| Rent | 1200 |
| Food | 400 |
| Total | =SUM(B2:B3) |`;

const stored = builtinArtifactKinds.fromModel("spreadsheet", GRID);

const version = (number: number, content: string): ArtifactVersion => ({
  artifactId: budget.id,
  content,
  conversationId,
  createdAt: `2026-10-16T09:0${number}:00.000Z`,
  editedBy: null,
  id: fixtureId("artifactVersion", number),
  language: null,
  messageId,
  number,
});

const versions = [
  version(1, builtinArtifactKinds.fromModel("spreadsheet", "| Item |")),
  version(2, stored),
];

const header = (content: ReactNode) => (
  <div data-testid="header">{content}</div>
);

const KEPT_NOTHING = /That edit wasn.t kept/;

const read = (text: string): Spreadsheet => JSON.parse(text) as Spreadsheet;

const renderView = (props: Partial<SpreadsheetViewProps> = {}) => {
  const onSave = vi.fn<SpreadsheetViewProps["onSave"]>((input) =>
    Promise.resolve({
      ...version(3, input.content),
      editedBy: fixtureId("user", 1),
    })
  );
  const onSelect = vi.fn();
  renderWithI18n(
    <div style={{ display: "flex", flexDirection: "column", height: 600 }}>
      <SpreadsheetView
        access="owner"
        artifact={budget}
        header={header}
        onSave={onSave}
        onSelect={onSelect}
        versions={versions}
        {...props}
      />
    </div>
  );
  return { onSave, onSelect };
};

const formulaBar = () =>
  screen.findByRole("textbox", { name: "Contents of cell A1" });

describe("SpreadsheetView", () => {
  it("draws the grid, with the sheets as tabs and the selected cell in the formula bar", async () => {
    renderView();
    expect(await formulaBar()).toHaveValue("Item");
    const grid = await screen.findByRole("region", { name: "Cells of Costs" });
    await waitFor(() => expect(grid.querySelector("canvas")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Costs" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("saves a formula typed into the formula bar as the next version", async () => {
    const { onSave } = renderView();
    const bar = await formulaBar();
    await userEvent.clear(bar);
    await userEvent.type(bar, "=B4*2{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 15_000,
    });
    const [input] = onSave.mock.calls[0] ?? [];
    expect(input?.baseVersionId).toBe(versions[1]?.id);
    expect(read(input?.content ?? "{}").sheets[0]?.cells.A1).toEqual({
      f: "B4*2",
    });
  });

  it("saves what's typed into a cell of the grid", async () => {
    const { onSave } = renderView();
    const grid = await screen.findByRole("region", { name: "Cells of Costs" });
    await waitFor(() => expect(grid.querySelector("canvas")).not.toBeNull());
    // Component tests have no Tailwind, so the flex layout that sizes the
    // grid in the app is missing: give it the height it would have.
    grid.style.height = "400px";
    // B2: past the row numbers, one column (112px) in, one row below the header.
    await userEvent.click(grid, { position: { x: 60 + 112, y: 36 + 34 + 10 } });
    expect(
      await screen.findByRole("textbox", { name: "Contents of cell B2" })
    ).toHaveValue("1200");
    // Typing opens the cell's editor (in Glide's portal) with what's typed.
    await userEvent.keyboard("1");
    const editor = await waitFor(() => {
      const found =
        document.querySelector<HTMLTextAreaElement>("#portal textarea");
      expect(found).not.toBeNull();
      return found as HTMLTextAreaElement;
    });
    expect(document.activeElement).toBe(editor);
    await userEvent.keyboard("300");
    await expect.poll(() => editor.value).toBe("1300");
    // Glide commits the value of its last render: let it render first.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 15_000,
    });
    const [input] = onSave.mock.calls[0] ?? [];
    expect(read(input?.content ?? "{}").sheets[0]?.cells.B2).toEqual({
      v: 1300,
    });
  });

  it("keeps nothing the kind's checks refuse, and says why", async () => {
    const { onSave } = renderView();
    const bar = await formulaBar();
    await userEvent.clear(bar);
    await userEvent.type(bar, "=WEBSERVICE(B2){Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(KEPT_NOTHING);
    expect(alert.textContent).toContain(
      "WEBSERVICE isn't a supported function"
    );
    expect(screen.getByText("Saved")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("adds a sheet", async () => {
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a sheet" })
    );
    expect(screen.getByRole("button", { name: "Sheet2" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      await screen.findByRole("region", { name: "Cells of Sheet2" })
    ).toBeVisible();
  });

  it("is read only for a viewer", async () => {
    renderView({ access: "viewer" });
    expect(await formulaBar()).toBeDisabled();
    expect(screen.getByText("Read only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add a sheet" })).toBeNull();
  });

  it("opens an older version read only, with Restore", async () => {
    const { onSave } = renderView({ versionId: versions[0]?.id });
    expect(await screen.findByText("Version 1, read only")).toBeVisible();
    expect(await formulaBar()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        baseVersionId: versions[1]?.id,
        content: versions[0]?.content,
      })
    );
  });

  it("offers Excel and CSV exports", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      await screen.findByRole("menuitem", { name: "Excel (.xlsx)" })
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "CSV of this sheet (.csv)" })
    ).toBeVisible();
  });
});

describe("the grid's model", () => {
  it("edits through the kind's operations, keeping a cell's format", () => {
    const formatted = builtinArtifactKinds.edit(
      "spreadsheet",
      stored,
      "set_range",
      {
        fmt: "$#,##0",
        range: "B2",
        values: [[1200]],
      }
    );
    expect(formatted.ok).toBe(true);
    const next = editCells(formatted.ok ? formatted.value : stored, "Costs", [
      { address: "B2", text: "1300" },
      { address: "A3", text: "" },
    ]);
    expect(next.ok && read(next.value).sheets[0]?.cells.B2).toEqual({
      fmt: "$#,##0",
      v: 1300,
    });
    expect(next.ok && read(next.value).sheets[0]?.cells.A3).toBeUndefined();
    expect(
      editCells(stored, "Costs", [{ address: "C1", text: "=C1" }])
    ).toEqual({
      error: [
        "these formulas refer to themselves, through each other: C1. Break the cycle",
      ],
      ok: false,
    });
  });

  it("names and adds sheets, and draws spare rows and columns to type into", () => {
    const spreadsheet = read(stored);
    expect(nextSheetName(spreadsheet)).toBe("Sheet2");
    const added = addSheet(stored, "Sheet2");
    expect(added.ok && read(added.value).sheets).toHaveLength(2);
    expect(gridSize(spreadsheet.sheets[0] ?? { cells: {}, name: "x" })).toEqual(
      {
        cols: 12,
        rows: 60,
      }
    );
  });
});

describe("the grid's theme", () => {
  it("is the page's tokens, resolved to colours Glide can draw", () => {
    const tokens = readGridTokens(document.documentElement);
    const theme = gridTheme(tokens);
    expect(theme.bgCell).toBe(toHex(tokens.background));
    expect(theme.textDark).toBe(toHex(tokens.foreground));
    expect(
      theme.accentLight?.endsWith(toHex(tokens.ring, 0.16).slice(-2))
    ).toBe(true);
    expect(toHex({ a: 255, b: 0, g: 128, r: 255 }, 0.5)).toHaveLength(9);
  });
});

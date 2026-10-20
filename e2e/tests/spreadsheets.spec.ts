import { readFile } from "node:fs/promises";

import { type Browser, expect, type Page, test } from "@playwright/test";
import type { ArtifactId } from "@workspace/contract/schemas/common";

import { apiFor, eventually } from "../support/api";
import { conversationIdOf, expectReply, send } from "../support/chat";
import { storageStateFor } from "../support/users";

// Spreadsheets (166) as a person meets them. The model writes a sheet as a
// Markdown table and it opens as a grid beside the chat, its formula
// computed; the model then sets a formula by cell, and one that calls a
// function outside the subset is refused. Ada types a value into
// the formula bar on the artifact's page, which saves a version, and
// exports the workbook to Excel and the sheet to CSV.

test.describe.configure({ mode: "serial" });

const APPROVE = /^Approve( all)?$/;
const TITLE = "Trip budget";
const SAVED_V1 = /Tool result: Saved "Trip budget" as version 1/;
const SAVED_V2 = /Tool result: Saved "Trip budget" as version 2/;
const UNSUPPORTED = /WEBSERVICE isn't a supported function/;
const BUDGET = [
  "## Sheet: Costs",
  "| Item | Cost |",
  "| Rail | 120 |",
  "| Hotel | 300 |",
  "| Total | =SUM(B2:B3) |",
].join("\n");

const signedIn = async (browser: Browser, baseURL: string) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const page = await context.newPage();
  return { api: await apiFor(context, baseURL), context, page };
};

const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

const formulaBar = (page: Page, address: string) =>
  page.getByRole("textbox", { name: `Contents of cell ${address}` });

let made: ArtifactId;

test("the model writes a spreadsheet, then sets a formula by cell", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto("/");
  await send(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: BUDGET, title: TITLE, type: "spreadsheet" })}]`
  );
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_V1);
  const chat = await conversationIdOf(page);
  const [artifact] = await api.artifacts.list({ conversationId: chat });
  expect(artifact).toMatchObject({ kind: "spreadsheet", title: TITLE });
  made = artifact?.id as ArtifactId;

  // It opens beside the chat as a grid, with its sheet as a tab.
  await page.getByRole("button", { name: `Open artifact: ${TITLE}` }).click();
  await expect(
    page.getByRole("region", { name: "Cells of Costs" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Costs" })).toBeVisible();
  await expect(formulaBar(page, "A1")).toHaveValue("Item");

  await send(
    page,
    `[tool:update_artifact ${JSON.stringify({
      artifactId: made,
      edit: { formula: "=B4/2", operation: "set_formula", range: "C4" },
    })}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, SAVED_V2);
  const versions = await api.artifacts.listVersions({ id: made });
  expect(versions).toHaveLength(2);
  const { cells } = JSON.parse(versions[1]?.content ?? "{}").sheets[0];
  expect(cells.C4).toEqual({ f: "B4/2" });
  expect(cells.B4).toEqual({ f: "SUM(B2:B3)" });

  // A function outside the supported subset is refused, and nothing saved.
  await send(
    page,
    `[tool:update_artifact ${JSON.stringify({
      artifactId: made,
      edit: {
        formula: "=WEBSERVICE(B2)",
        operation: "set_formula",
        range: "D1",
      },
    })}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, UNSUPPORTED);
  expect(await api.artifacts.listVersions({ id: made })).toHaveLength(2);
  await context.close();
});

test("Ada types into the grid on its own page, which saves a version", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto(`/artifacts/${made}`);
  const status = page.locator("[data-save-state]");
  await expect(status).toHaveAttribute("data-save-state", "saved");
  const bar = formulaBar(page, "A1");
  await expect(bar).toHaveValue("Item");
  await bar.fill("Line");
  await bar.press("Enter");
  await expect(status).toHaveAttribute("data-save-state", "saved", {
    timeout: 10_000,
  });
  const versions = await eventually(
    () => api.artifacts.listVersions({ id: made }),
    (each) => each.length === 3
  );
  expect(versions[2]?.editedBy).toBeTruthy();
  expect(JSON.parse(versions[2]?.content ?? "{}").sheets[0].cells.A1).toEqual({
    v: "Line",
  });
  await context.close();
});

test("exports the workbook to Excel and the sheet to CSV", async ({
  baseURL,
  browser,
}) => {
  const { context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto(`/artifacts/${made}`);
  await expect(formulaBar(page, "A1")).toHaveValue("Line");

  await page.getByRole("button", { name: "Export" }).click();
  const csvDownload = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "CSV of this sheet (.csv)" })
    .click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toBe("Trip-budget.csv");
  expect(await readFile((await csv.path()) ?? "", "utf8")).toBe(
    "Line,Cost,\r\nRail,120,\r\nHotel,300,\r\nTotal,420,210\r\n"
  );

  await page.getByRole("button", { name: "Export" }).click();
  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Excel (.xlsx)" }).click();
  const xlsx = await xlsxDownload;
  expect(xlsx.suggestedFilename()).toBe("Trip-budget.xlsx");
  const bytes = await readFile((await xlsx.path()) ?? "");
  // An .xlsx is a zip with the workbook part.
  expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  expect(bytes.toString("latin1")).toContain("xl/workbook.xml");
  await context.close();
});

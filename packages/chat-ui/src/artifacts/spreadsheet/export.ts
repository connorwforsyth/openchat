import { sheetToCsv } from "@workspace/artifacts-kit/kinds/spreadsheet/csv";
import type { Spreadsheet } from "@workspace/artifacts-kit/kinds/spreadsheet/schema";

import { downloadFile, exportFileName } from "../document/export";

// A spreadsheet out of the app (166), all in the browser: the workbook as
// an Excel file (exceljs loads only when someone exports one), or the
// sheet on screen as CSV, its computed values.

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const exportXlsx = async (
  spreadsheet: Spreadsheet,
  title: string
): Promise<void> => {
  const { spreadsheetToXlsx } = await import(
    "@workspace/artifacts-kit/kinds/spreadsheet/xlsx"
  );
  const bytes = await spreadsheetToXlsx(spreadsheet);
  downloadFile(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_TYPE }),
    exportFileName(title, "xlsx")
  );
};

/** One sheet as CSV, named after the artifact (and the sheet, when there are several). */
export const exportCsv = (
  spreadsheet: Spreadsheet,
  sheetIndex: number,
  title: string
): void => {
  const sheet = spreadsheet.sheets[sheetIndex];
  const name =
    spreadsheet.sheets.length > 1 && sheet ? `${title} ${sheet.name}` : title;
  downloadFile(
    new Blob([sheetToCsv(spreadsheet, sheetIndex)], {
      type: "text/csv;charset=utf-8",
    }),
    exportFileName(name, "csv")
  );
};

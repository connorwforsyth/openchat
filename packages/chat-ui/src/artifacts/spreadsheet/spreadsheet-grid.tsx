"use client";

import "@glideapps/glide-data-grid/dist/index.css";

import {
  CompactSelection,
  DataEditor,
  type EditableGridCell,
  type GridCell,
  GridCellKind,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from "@glideapps/glide-data-grid";
import { useLingui } from "@lingui/react/macro";
import type { Evaluated } from "@workspace/artifacts-kit/kinds/spreadsheet/evaluate";
import {
  columnLetters,
  parseAddress,
  type Sheet,
  toAddress,
} from "@workspace/artifacts-kit/kinds/spreadsheet/schema";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type CellEdit, cellView, columnWidth, gridSize } from "./model";
import { gridTheme, readGridTokens, toHex } from "./theme";

// The grid itself (166), on Glide Data Grid (MIT): a canvas grid that
// stays fast at thousands of rows, with Excel's keyboard (arrows, Enter
// and typing to edit, Delete to clear, copy and paste). It shows each
// cell's computed value and edits its formula; what a person types goes
// up as edits, and the view decides what's saved. Loaded on its own, only
// when a spreadsheet opens.

export interface SpreadsheetGridProps {
  readonly evaluated: Evaluated;
  /** Edits to save, several at once for a paste or a cleared selection. */
  readonly onEdit: (edits: readonly CellEdit[]) => void;
  readonly onSelect: (address: string | null) => void;
  readonly readOnly: boolean;
  readonly selected: string | null;
  readonly sheet: Sheet;
  readonly sheetIndex: number;
}

/** Glide opens its in-cell editor in `#portal`; make one if the page has none. */
const usePortal = () => {
  useEffect(() => {
    if (document.getElementById("portal")) {
      return;
    }
    const portal = document.createElement("div");
    portal.id = "portal";
    portal.style.position = "fixed";
    portal.style.insetInlineStart = "0";
    portal.style.top = "0";
    portal.style.zIndex = "50";
    document.body.append(portal);
  }, []);
};

/** The grid's theme, from the tokens under `ref`, again when the theme changes. */
const useGridTheme = (ref: RefObject<HTMLElement | null>) => {
  const [theme, setTheme] = useState<
    { readonly error: string; readonly grid: Partial<Theme> } | undefined
  >();
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => {
      const tokens = readGridTokens(element);
      setTheme({ error: toHex(tokens.destructive), grid: gridTheme(tokens) });
    };
    update();
    // The light/dark switch is a class on <html>.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, [ref]);
  return theme;
};

const selectionOf = (address: string | null): GridSelection => {
  const at = address ? parseAddress(address) : null;
  return {
    columns: CompactSelection.empty(),
    current: at
      ? {
          cell: [at.col, at.row],
          range: { height: 1, width: 1, x: at.col, y: at.row },
          rangeStack: [],
        }
      : undefined,
    rows: CompactSelection.empty(),
  };
};

const textOf = (value: EditableGridCell): string | null => {
  switch (value.kind) {
    case GridCellKind.Text:
      return value.data;
    case GridCellKind.Number:
      return value.data === undefined ? "" : String(value.data);
    default:
      return null;
  }
};

export function SpreadsheetGrid({
  evaluated,
  onEdit,
  onSelect,
  readOnly,
  selected,
  sheet,
  sheetIndex,
}: SpreadsheetGridProps) {
  const { i18n, t } = useLingui();
  usePortal();
  const frame = useRef<HTMLElement>(null);
  const theme = useGridTheme(frame);
  const size = gridSize(sheet);
  const sheetName = sheet.name;
  const columns = useMemo<GridColumn[]>(
    () =>
      Array.from({ length: size.cols }, (_, col) => ({
        id: columnLetters(col),
        title: columnLetters(col),
        width: columnWidth(sheet, col),
      })),
    [sheet, size.cols]
  );
  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const view = cellView(
        sheet,
        evaluated,
        sheetIndex,
        toAddress(col, row),
        i18n.locale
      );
      return {
        allowOverlay: !readOnly,
        contentAlign: view.isNumber ? "right" : undefined,
        data: view.edit,
        displayData: view.display,
        kind: GridCellKind.Text,
        readonly: readOnly,
        ...(view.isError && theme
          ? { themeOverride: { textDark: theme.error } }
          : {}),
      };
    },
    [evaluated, i18n.locale, readOnly, sheet, sheetIndex, theme]
  );
  const onCellsEdited = useCallback(
    (
      edits: readonly {
        readonly location: Item;
        readonly value: EditableGridCell;
      }[]
    ) => {
      onEdit(
        edits.flatMap(({ location: [col, row], value }) => {
          const text = textOf(value);
          return text === null ? [] : [{ address: toAddress(col, row), text }];
        })
      );
      return true;
    },
    [onEdit]
  );
  const onCellEdited = useCallback(
    (location: Item, value: EditableGridCell) =>
      onCellsEdited([{ location, value }]),
    [onCellsEdited]
  );
  const onGridSelectionChange = useCallback(
    (selection: GridSelection) => {
      const cell = selection.current?.cell;
      onSelect(cell ? toAddress(cell[0], cell[1]) : null);
    },
    [onSelect]
  );
  const gridSelection = useMemo(() => selectionOf(selected), [selected]);
  return (
    <section
      aria-label={t`Cells of ${sheetName}`}
      className="relative min-h-0 flex-1"
      data-slot="spreadsheet-grid"
      ref={frame}
    >
      {theme ? (
        <DataEditor
          columns={columns}
          getCellContent={getCellContent}
          getCellsForSelection
          gridSelection={gridSelection}
          height="100%"
          onCellEdited={onCellEdited}
          onCellsEdited={onCellsEdited}
          onGridSelectionChange={onGridSelectionChange}
          onPaste
          rowMarkers="number"
          rows={size.rows}
          smoothScrollX
          smoothScrollY
          theme={theme.grid}
          width="100%"
        />
      ) : null}
    </section>
  );
}

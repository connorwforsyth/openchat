"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { evaluateSpreadsheet } from "@workspace/artifacts-kit/kinds/spreadsheet/evaluate";
import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactAccess,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  DownloadIcon,
  PlusIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ArtifactSelection } from "../artifact-view";
import { OlderVersion, SaveStatus } from "../editor/save-status";
import { type SaveVersion, useVersionSave } from "../editor/use-version-save";
import { exportCsv, exportXlsx } from "./export";
import {
  addSheet,
  type CellEdit,
  cellView,
  editCells,
  nextSheetName,
  readSpreadsheet,
} from "./model";

// A Spreadsheet artifact (166): a title bar (the title, its versions,
// whether edits are saved, Export, and what the host adds), a formula bar
// for the selected cell, the grid, and the sheets as tabs under it. A
// person's edit is checked by the kind's own rules before it's kept, and
// saved as a new version after a pause, as a document's are (126). Older
// versions open read only, with Restore.

export interface SpreadsheetViewProps {
  /** The caller's access: an owner or editor edits; anyone else reads. `null` while unknown. */
  readonly access: ArtifactAccess | null;
  readonly actions?: ReactNode;
  readonly artifact: Artifact;
  readonly header: (content: ReactNode) => ReactNode;
  readonly onSave: SaveVersion;
  readonly onSelect: (selection: ArtifactSelection) => void;
  /** The version shown; omitted, the latest. */
  readonly versionId?: ArtifactVersionId;
  /** Every version, oldest first. */
  readonly versions: readonly ArtifactVersion[];
}

const SpreadsheetGrid = lazy(() =>
  import("./spreadsheet-grid").then((module) => ({
    default: module.SpreadsheetGrid,
  }))
);

export function SpreadsheetView({
  access,
  actions,
  artifact,
  header,
  onSave,
  onSelect,
  versionId,
  versions,
}: SpreadsheetViewProps) {
  const latest = versions.at(-1);
  const found = versionId
    ? versions.findIndex((each) => each.id === versionId)
    : -1;
  const index = found < 0 ? versions.length - 1 : found;
  const shown = versions[index];
  if (!(latest && shown)) {
    return null;
  }
  const isLatest = shown.id === latest.id;
  const mayEdit = access === "owner" || access === "editor";
  return (
    <SheetEditor
      actions={actions}
      artifact={artifact}
      canEdit={mayEdit && isLatest}
      header={header}
      index={index}
      // An older version is its own read-only grid; the latest stays
      // mounted while it's edited, so a save never moves the selection.
      key={isLatest ? "latest" : shown.id}
      latest={latest}
      mayEdit={mayEdit}
      onSave={onSave}
      onSelect={onSelect}
      shown={shown}
      versions={versions}
    />
  );
}

function SheetEditor({
  actions,
  artifact,
  canEdit,
  header,
  index,
  latest,
  mayEdit,
  onSave,
  onSelect,
  shown,
  versions,
}: Omit<SpreadsheetViewProps, "access" | "versionId"> & {
  readonly canEdit: boolean;
  readonly index: number;
  readonly latest: ArtifactVersion;
  readonly mayEdit: boolean;
  readonly shown: ArtifactVersion;
}) {
  const { i18n, t } = useLingui();
  const [content, setContent] = useState(shown.content);
  const spreadsheet = useMemo(() => readSpreadsheet(content), [content]);
  const evaluated = useMemo(
    () => (spreadsheet ? evaluateSpreadsheet(spreadsheet) : null),
    [spreadsheet]
  );
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>("A1");
  const [problems, setProblems] = useState<readonly string[]>([]);
  const save = useVersionSave({ baseVersionId: latest.id, save: onSave });
  const { change, saved: isMine, state } = save;

  // A version made elsewhere (the model, another editor) shows at once when
  // nothing here waits to be saved; otherwise the save reports a conflict.
  const latestShown = useRef(latest.id);
  useEffect(() => {
    if (latestShown.current === latest.id || shown.id !== latest.id) {
      return;
    }
    latestShown.current = latest.id;
    if (!isMine(latest.id) && state === "saved") {
      setContent(latest.content);
    }
  }, [isMine, latest, shown.id, state]);

  const sheets = spreadsheet?.sheets ?? [];
  const activeIndex = Math.min(sheetIndex, Math.max(0, sheets.length - 1));
  const sheet = sheets[activeIndex];

  const keep = useCallback(
    (
      result:
        | { readonly ok: true; readonly value: string }
        | { readonly error: readonly string[]; readonly ok: false }
    ) => {
      if (!result.ok) {
        setProblems(result.error);
        return false;
      }
      setProblems([]);
      setContent(result.value);
      change(result.value);
      return true;
    },
    [change]
  );
  const edit = useCallback(
    (edits: readonly CellEdit[]) => {
      if (canEdit && sheet && edits.length > 0) {
        keep(editCells(content, sheet.name, edits));
      }
    },
    [canEdit, content, keep, sheet]
  );
  const newSheet = useCallback(() => {
    if (spreadsheet && keep(addSheet(content, nextSheetName(spreadsheet)))) {
      setSheetIndex(spreadsheet.sheets.length);
    }
  }, [content, keep, spreadsheet]);

  const loadLatest = useCallback(() => {
    setContent(latest.content);
    setProblems([]);
    save.reset(latest.id);
  }, [latest, save]);
  const keepMine = useCallback(
    () => save.keepMine(latest.id),
    [latest.id, save]
  );
  const retry = useCallback(() => {
    save.flush().catch(() => undefined);
  }, [save]);
  const restore = useCallback(() => {
    onSave({ baseVersionId: latest.id, content: shown.content })
      .then((version) =>
        onSelect({ artifactId: artifact.id, versionId: version.id })
      )
      .catch(() => undefined);
  }, [artifact.id, latest.id, onSave, onSelect, shown.content]);

  const exports = {
    csv: () => {
      if (spreadsheet) {
        exportCsv(spreadsheet, activeIndex, artifact.title);
      }
    },
    xlsx: () => {
      if (spreadsheet) {
        exportXlsx(spreadsheet, artifact.title).catch(() => undefined);
      }
    },
  };

  const isLatest = shown.id === latest.id;
  const selectedView =
    sheet && evaluated && selected
      ? cellView(sheet, evaluated, activeIndex, selected, i18n.locale)
      : null;
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-artifact-kind="spreadsheet"
    >
      {header(
        <TitleBar
          actions={actions}
          artifact={artifact}
          exports={exports}
          index={index}
          onSelect={onSelect}
          status={
            isLatest ? (
              <SaveStatus
                canEdit={canEdit}
                onKeepMine={keepMine}
                onLoadLatest={loadLatest}
                onRetry={retry}
                state={state}
              />
            ) : (
              <OlderVersion
                canRestore={mayEdit}
                number={shown.number}
                onRestore={restore}
              />
            )
          }
          versions={versions}
        />
      )}
      {sheet && evaluated ? (
        <>
          <FormulaBar
            address={selected}
            canEdit={canEdit}
            key={`${activeIndex}:${selected ?? ""}:${selectedView?.edit ?? ""}`}
            onCommit={edit}
            text={selectedView?.edit ?? ""}
          />
          {problems.length > 0 ? (
            <div
              className="flex shrink-0 items-start gap-2 border-b bg-muted px-3 py-2 text-xs"
              role="alert"
            >
              <CircleAlertIcon
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-destructive"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-medium">
                  <Trans>That edit wasn't kept:</Trans>
                </p>
                <ul className="text-muted-foreground">
                  {problems.slice(0, 3).map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <ClientOnly fallback={<GridLoading />}>
            <Suspense fallback={<GridLoading />}>
              <SpreadsheetGrid
                evaluated={evaluated}
                onEdit={edit}
                onSelect={setSelected}
                readOnly={!canEdit}
                selected={selected}
                sheet={sheet}
                sheetIndex={activeIndex}
              />
            </Suspense>
          </ClientOnly>
          <div
            aria-label={t`Sheets`}
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-t px-2 py-1"
            role="toolbar"
          >
            {sheets.map((each, position) => (
              <SheetTab
                active={position === activeIndex}
                key={each.name}
                name={each.name}
                onPick={setSheetIndex}
                position={position}
              />
            ))}
            {canEdit ? (
              <Button
                aria-label={t`Add a sheet`}
                onClick={newSheet}
                size="icon-xs"
                title={t`Add a sheet`}
                variant="ghost"
              >
                <PlusIcon aria-hidden />
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="p-4 text-destructive text-sm" role="alert">
          <Trans>This version couldn't be read as a spreadsheet.</Trans>
        </p>
      )}
    </div>
  );
}

function SheetTab({
  active,
  name,
  onPick,
  position,
}: {
  readonly active: boolean;
  readonly name: string;
  readonly onPick: (position: number) => void;
  readonly position: number;
}) {
  const pick = useCallback(() => onPick(position), [onPick, position]);
  return (
    <Button
      aria-pressed={active}
      className={cn(
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
      )}
      onClick={pick}
      size="xs"
      variant="ghost"
    >
      {name}
    </Button>
  );
}

function GridLoading() {
  return (
    <div aria-busy className="flex-1 p-3" role="status">
      <span className="sr-only">
        <Trans>Loading the grid</Trans>
      </span>
      <Skeleton className="h-full min-h-48 w-full" />
    </div>
  );
}

/** Renders `children` only in the browser: the grid draws on a canvas. */
function ClientOnly({
  children,
  fallback,
}: {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? children : fallback;
}

/** The selected cell's address and contents, to read a formula or type one. */
function FormulaBar({
  address,
  canEdit,
  onCommit,
  text,
}: {
  readonly address: string | null;
  readonly canEdit: boolean;
  readonly onCommit: (edits: readonly CellEdit[]) => void;
  readonly text: string;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(text);
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    []
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && address) {
        event.preventDefault();
        onCommit([{ address, text: draft }]);
      } else if (event.key === "Escape") {
        setDraft(text);
      }
    },
    [address, draft, onCommit, text]
  );
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <span
        className="w-12 shrink-0 font-mono text-muted-foreground text-xs tabular-nums"
        data-slot="spreadsheet-address"
      >
        {address ?? ""}
      </span>
      <Input
        aria-label={
          address ? t`Contents of cell ${address}` : t`Contents of the cell`
        }
        className="h-7 font-mono text-xs"
        disabled={!(canEdit && address)}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={canEdit ? t`A value, or a formula starting with =` : ""}
        value={draft}
      />
    </div>
  );
}

function TitleBar({
  actions,
  artifact,
  exports,
  index,
  onSelect,
  status,
  versions,
}: {
  readonly actions?: ReactNode;
  readonly artifact: Artifact;
  readonly exports: Readonly<Record<"csv" | "xlsx", () => void>>;
  readonly index: number;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly status: ReactNode;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
  const step = useCallback(
    (delta: -1 | 1) => {
      const target = versions[index + delta];
      if (target) {
        onSelect({ artifactId: artifact.id, versionId: target.id });
      }
    },
    [artifact.id, index, onSelect, versions]
  );
  const older = useCallback(() => step(-1), [step]);
  const newer = useCallback(() => step(1), [step]);
  const number = versions[index]?.number ?? index + 1;
  const total = versions.length;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <h2
        className="min-w-0 flex-1 truncate font-medium text-sm"
        title={artifact.title}
      >
        {artifact.title}
      </h2>
      {total > 1 ? (
        // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields.
        <div
          aria-label={t`Versions`}
          className="hidden shrink-0 items-center sm:flex"
          role="group"
        >
          <Button
            aria-label={t`Older version`}
            disabled={index === 0}
            onClick={older}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <span
            aria-live="polite"
            className="min-w-14 text-center text-muted-foreground text-xs tabular-nums"
          >
            <Trans>
              v{number} of {total}
            </Trans>
          </span>
          <Button
            aria-label={t`Newer version`}
            disabled={index >= total - 1}
            onClick={newer}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      {status}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Export`}
              size="sm"
              title={t`Export`}
              variant="ghost"
            />
          }
        >
          <DownloadIcon aria-hidden data-icon="inline-start" />
          <span className="hidden md:inline">
            <Trans>Export</Trans>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={exports.xlsx}>
              <Trans>Excel (.xlsx)</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exports.csv}>
              <Trans>CSV of this sheet (.csv)</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {actions}
    </div>
  );
}

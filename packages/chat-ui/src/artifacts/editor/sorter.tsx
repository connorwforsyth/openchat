"use client";

// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/components/thumbnail-rail.tsx. MIT, Copyright (c)
// 2026 Yiwei Ho; see NOTICE.open-slide.

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  EllipsisIcon,
  PlusIcon,
  Trash2Icon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// An artifact editor's sorter, shared by every kind: its pieces in order (a
// deck's slides, later a workbook's sheets), to pick one, drag or Alt+Arrow
// it to another place, and add, duplicate or delete through its menu. The
// thumbnails are the kind's: drawn in each row (`thumbnail`), or drawn
// behind the list by the kind with the rows laid over them where it says
// they sit (`backdrop` and `boxes`), as the slides editor does with one
// frame for the whole deck.

export interface SorterItem {
  readonly id: string;
  /** What a screen reader calls it ("Slide 2"). */
  readonly label: string;
}

/** Where a row sits over the backdrop, in pixels from its top. */
export interface SorterBox {
  readonly height: number;
  readonly top: number;
}

export interface SorterProps {
  /** Its "add" button's words ("Add slide"). */
  readonly addLabel: string;
  /** Drawn behind the rows; with `boxes`, the rows lie over it. */
  readonly backdrop?: ReactNode;
  readonly boxes?: readonly SorterBox[];
  /** Whether the pieces can be changed; read only, they can still be picked. */
  readonly canEdit: boolean;
  readonly items: readonly SorterItem[];
  /** What the list is ("Slides"). */
  readonly label: string;
  readonly onAdd: () => void;
  readonly onDelete: (id: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onMove: (id: string, index: number) => void;
  readonly onSelect: (id: string) => void;
  readonly selected: string | null;
  /** A row's own thumbnail, when there's no backdrop. */
  readonly thumbnail?: (item: SorterItem, index: number) => ReactNode;
}

const MOVE_KEYS: Readonly<Record<string, -1 | 1>> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

/** Where a drop lands: before the row under the pointer, or after it. */
export const dropIndex = (
  over: number,
  pointerY: number,
  box: { readonly height: number; readonly top: number }
): number => (pointerY < box.top + box.height / 2 ? over : over + 1);

/** The index a dragged item moves to, given where it's dropped. */
export const moveTarget = (from: number, dropAt: number): number =>
  dropAt > from ? dropAt - 1 : dropAt;

export function Sorter({
  addLabel,
  backdrop,
  boxes,
  canEdit,
  items,
  label,
  onAdd,
  onDelete,
  onDuplicate,
  onMove,
  onSelect,
  selected,
  thumbnail,
}: SorterProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const ids = items.map((item) => item.id);
  const overlaid = backdrop !== undefined && boxes !== undefined;

  // A moved row keeps focus where it lands.
  useEffect(() => {
    const focused = document.activeElement;
    if (
      selected &&
      focused instanceof HTMLElement &&
      focused.dataset.sorterItem !== undefined &&
      focused.dataset.sorterItem !== selected
    ) {
      list.current
        ?.querySelector<HTMLElement>(
          `[data-sorter-item="${CSS.escape(selected)}"]`
        )
        ?.focus();
    }
  }, [selected]);

  const move = useCallback(
    (id: string, index: number) => {
      if (index >= 0 && index < ids.length && index !== ids.indexOf(id)) {
        onMove(id, index);
      }
    },
    [ids, onMove]
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) =>
      onSelect(event.currentTarget.dataset.sorterItem ?? ""),
    [onSelect]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.sorterItem ?? "";
      const at = ids.indexOf(id);
      const step = MOVE_KEYS[event.key];
      if (step && event.altKey && canEdit) {
        event.preventDefault();
        move(id, at + step);
      } else if (step && !event.altKey) {
        // Up and down walk the rows, as a list does.
        const next = ids[at + step];
        if (next) {
          event.preventDefault();
          onSelect(next);
          list.current
            ?.querySelector<HTMLElement>(
              `[data-sorter-item="${CSS.escape(next)}"]`
            )
            ?.focus();
        }
      }
    },
    [canEdit, ids, move, onSelect]
  );

  const onDragStart = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "move";
    setDragging(event.currentTarget.dataset.sorterItem ?? null);
  }, []);

  const onDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      if (!dragging) {
        return;
      }
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      setDropAt(
        dropIndex(
          ids.indexOf(event.currentTarget.dataset.sorterItem ?? ""),
          event.clientY,
          box
        )
      );
    },
    [dragging, ids]
  );

  const onDragEnd = useCallback(() => {
    setDragging(null);
    setDropAt(null);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (dragging !== null && dropAt !== null) {
        move(dragging, moveTarget(ids.indexOf(dragging), dropAt));
      }
      onDragEnd();
    },
    [dragging, dropAt, ids, move, onDragEnd]
  );

  return (
    <nav
      aria-label={label}
      className="flex h-full min-h-0 w-full flex-col overflow-y-auto"
    >
      <div className={cn("relative", !overlaid && "p-2")}>
        {overlaid ? backdrop : null}
        <ol
          className={cn(overlaid ? "absolute inset-0" : "flex flex-col gap-2")}
          ref={list}
        >
          {items.map((item, index) => {
            const box = boxes?.[index];
            if (overlaid && !box) {
              return null;
            }
            const style: CSSProperties | undefined = box
              ? { height: box.height, top: box.top }
              : undefined;
            return (
              <SorterRow
                canEdit={canEdit}
                current={item.id === selected}
                dragged={item.id === dragging}
                dropAfter={dropAt === index + 1 && index === items.length - 1}
                dropBefore={dropAt === index}
                index={index}
                item={item}
                key={item.id}
                last={index === items.length - 1}
                onClick={onClick}
                onDelete={onDelete}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onDuplicate={onDuplicate}
                onKeyDown={onKeyDown}
                onMove={move}
                overlaid={overlaid}
                single={items.length === 1}
                style={style}
                thumbnail={overlaid ? null : thumbnail?.(item, index)}
              />
            );
          })}
        </ol>
      </div>
      {canEdit ? (
        <Button
          className="m-2 shrink-0"
          onClick={onAdd}
          size="sm"
          variant="outline"
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          {addLabel}
        </Button>
      ) : null}
    </nav>
  );
}

function SorterRow({
  canEdit,
  current,
  dragged,
  dropAfter,
  dropBefore,
  index,
  item,
  last,
  onClick,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onDuplicate,
  onKeyDown,
  onMove,
  overlaid,
  single,
  style,
  thumbnail,
}: {
  readonly canEdit: boolean;
  readonly current: boolean;
  readonly dragged: boolean;
  readonly dropAfter: boolean;
  readonly dropBefore: boolean;
  readonly index: number;
  readonly item: SorterItem;
  readonly last: boolean;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onDelete: (id: string) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onMove: (id: string, index: number) => void;
  readonly overlaid: boolean;
  readonly single: boolean;
  readonly style: CSSProperties | undefined;
  readonly thumbnail: ReactNode;
}) {
  return (
    <li
      className={cn(
        "group/row",
        overlaid ? "absolute inset-x-2" : "relative",
        dragged && "opacity-50"
      )}
      style={style}
    >
      {dropBefore ? <DropLine edge="start" /> : null}
      {dropAfter ? <DropLine edge="end" /> : null}
      <button
        aria-current={current ? "true" : undefined}
        aria-label={item.label}
        className={cn(
          "block w-full rounded-md text-start outline-none ring-offset-1 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
          overlaid && "absolute inset-0",
          current && "ring-2 ring-primary"
        )}
        data-sorter-item={item.id}
        draggable={canEdit}
        onClick={onClick}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        type="button"
      >
        {thumbnail}
      </button>
      <span
        aria-hidden
        className="pointer-events-none absolute start-1 bottom-1 rounded-sm bg-background/90 px-1 text-muted-foreground text-xs tabular-nums"
      >
        {index + 1}
      </span>
      {canEdit ? (
        <RowMenu
          first={index === 0}
          id={item.id}
          index={index}
          last={last}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onMove={onMove}
          single={single}
        />
      ) : null}
    </li>
  );
}

function DropLine({ edge }: { readonly edge: "end" | "start" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary",
        edge === "start" ? "-top-1" : "-bottom-1"
      )}
    />
  );
}

function RowMenu({
  first,
  id,
  index,
  last,
  onDelete,
  onDuplicate,
  onMove,
  single,
}: {
  readonly first: boolean;
  readonly id: string;
  readonly index: number;
  readonly last: boolean;
  readonly onDelete: (id: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onMove: (id: string, index: number) => void;
  readonly single: boolean;
}) {
  const { t } = useLingui();
  const duplicate = useCallback(() => onDuplicate(id), [id, onDuplicate]);
  const remove = useCallback(() => onDelete(id), [id, onDelete]);
  const up = useCallback(() => onMove(id, index - 1), [id, index, onMove]);
  const down = useCallback(() => onMove(id, index + 1), [id, index, onMove]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Actions for ${index + 1}`}
            className="absolute end-1 top-1 bg-background/90 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-popup-open:opacity-100"
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onClick={duplicate}>
          <CopyIcon aria-hidden />
          <Trans>Duplicate</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onClick={up}>
          <ArrowUpIcon aria-hidden />
          <Trans>Move up</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onClick={down}>
          <ArrowDownIcon aria-hidden />
          <Trans>Move down</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={single}
          onClick={remove}
          variant="destructive"
        >
          <Trash2Icon aria-hidden />
          <Trans>Delete</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

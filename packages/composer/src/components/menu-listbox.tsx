"use client";

import { Trans } from "@lingui/react/macro";
import { cn } from "@workspace/ui/lib/utils";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";

// The listbox behind every `/` and `@` menu: the composer's, the document
// editor's block menu and the library's snippet editors. It draws options
// only; the editor that opened it owns the keys (`triggers.ts`) and points
// at the active option with aria-activedescendant.

export const optionId = (listboxId: string, index: number) =>
  `${listboxId}-option-${index}`;

// Focus never leaves the editor: it owns the keyboard (arrows, Enter,
// Escape), the ARIA pattern for autocomplete inside a text field. So
// options take pointer input only, and mousedown is cancelled to keep the
// caret where it was.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** Sections for a long menu: which one an item is in, and its heading. */
export interface MenuGroups<T> {
  readonly of: (item: T) => string;
  readonly title: (group: string) => string;
}

interface Section<T> {
  readonly entries: readonly T[];
  readonly group: string;
  /** The first entry's index in the whole list. */
  readonly start: number;
}

/** Runs of items in the same group, in list order. Pure. */
export const menuSections = <T,>(
  items: readonly T[],
  groupOf: (item: T) => string
): readonly Section<T>[] => {
  const runs: { entries: T[]; group: string; start: number }[] = [];
  for (const [index, item] of items.entries()) {
    const group = groupOf(item);
    const last = runs.at(-1);
    if (last?.group === group) {
      last.entries.push(item);
    } else {
      runs.push({ entries: [item], group, start: index });
    }
  }
  return runs;
};

export interface MenuListboxProps<T> {
  readonly activeIndex: number;
  /** The frame's classes: where it sits and how wide it is. */
  readonly className?: string;
  /** With groups, each section gets a heading and `title` only names the listbox. */
  readonly groups?: MenuGroups<T>;
  readonly id: string;
  readonly itemKey: (item: T) => string;
  readonly items: readonly T[];
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  /** An option's icon and text. */
  readonly renderItem: (item: T) => ReactNode;
  readonly slot: string;
  readonly title: string;
}

export function MenuListbox<T>({
  activeIndex,
  className,
  groups,
  id,
  itemKey,
  items,
  onChoose,
  onHover,
  renderItem,
  slot,
  title,
}: MenuListboxProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  // Arrowing past the visible options scrolls the next one into view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(id, activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  const titleId = `${id}-title`;
  const option = (item: T, index: number) => (
    <MenuOption
      active={index === activeIndex}
      id={optionId(id, index)}
      index={index}
      key={itemKey(item)}
      onChoose={onChoose}
      onHover={onHover}
    >
      {renderItem(item)}
    </MenuOption>
  );

  return (
    <div
      className={cn(
        "z-50 flex max-h-72 flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className
      )}
      data-slot={slot}
    >
      {groups ? null : (
        <p
          className="px-1.5 py-1 font-medium text-muted-foreground text-xs"
          id={titleId}
        >
          {title}
        </p>
      )}
      <div
        aria-label={groups ? title : undefined}
        aria-labelledby={groups ? undefined : titleId}
        className="overflow-y-auto"
        id={id}
        ref={listRef}
        role="listbox"
      >
        {groups
          ? menuSections(items, groups.of).map(({ entries, group, start }) => {
              const headingId = `${id}-group-${group}`;
              return (
                // biome-ignore lint/a11y/useSemanticElements: ARIA's grouped listbox; a fieldset is for form controls, not options.
                <div aria-labelledby={headingId} key={group} role="group">
                  <div
                    className="px-1.5 pt-1.5 pb-0.5 font-medium text-muted-foreground text-xs"
                    id={headingId}
                  >
                    {groups.title(group)}
                  </div>
                  {entries.map((item, offset) => option(item, start + offset))}
                </div>
              );
            })
          : items.map(option)}
      </div>
    </div>
  );
}

function MenuOption({
  active,
  children,
  id,
  index,
  onChoose,
  onHover,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly id: string;
  readonly index: number;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
}) {
  const handleClick = useCallback(() => onChoose(index), [index, onChoose]);
  const handleMouseMove = useCallback(() => onHover(index), [index, onHover]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the editor handles this listbox's keys (see keepFocus).
    <div
      aria-selected={active}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "bg-accent text-accent-foreground"
      )}
      id={id}
      onClick={handleClick}
      onMouseDown={keepFocus}
      onMouseMove={handleMouseMove}
      role="option"
      // Focusable in principle, as the role requires, but never tabbed to.
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

/** A name, with a quieter hint at the far end (a command, an email, a folder). */
export function MenuLabel({
  draft = false,
  hint,
  label,
  mono = false,
}: {
  /** The owner's unpublished draft: only they see it. */
  readonly draft?: boolean;
  readonly hint?: string;
  readonly label: string;
  readonly mono?: boolean;
}) {
  return (
    <>
      <span className="truncate">{label}</span>
      {draft ? (
        <span className="shrink-0 rounded-sm bg-muted px-1 text-muted-foreground text-xs">
          <Trans>Draft</Trans>
        </span>
      ) : null}
      {hint ? (
        <span
          className={cn(
            "ms-auto text-muted-foreground text-xs",
            mono ? "shrink-0 font-mono" : "truncate"
          )}
        >
          {hint}
        </span>
      ) : null}
    </>
  );
}

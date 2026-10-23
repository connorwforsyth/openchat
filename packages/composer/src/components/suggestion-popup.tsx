"use client";

import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

import type { PopupMenu } from "../hooks/use-suggestion-popup";
import { MenuListbox, optionId } from "./menu-listbox";

// A `useSuggestionPopup` menu drawn at the caret: below the trigger, or
// above it when the page has no room left underneath. Portalled to the
// body so a scrolling page or a clipped panel never cuts it off.

const GAP = 4;
/** About the listbox's max height (`max-h-72`) plus its frame. */
const ROOM = 300;

export interface SuggestionPopupProps<I> {
  readonly id: string;
  readonly itemKey: (item: I) => string;
  readonly menu: PopupMenu<I> | null;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly renderItem: (item: I) => ReactNode;
  /** The editable element, which gets the combobox's ARIA while the menu is open. */
  readonly target: HTMLElement | null;
  readonly title: string;
}

// The caret's rect is in physical pixels, so the popup is placed with
// physical `left`, which is right in either writing direction.
const position = (rect: DOMRect) =>
  window.innerHeight - rect.bottom >= ROOM
    ? { left: rect.left, top: rect.bottom + GAP }
    : { bottom: window.innerHeight - rect.top + GAP, left: rect.left };

export function SuggestionPopup<I>({
  id,
  itemKey,
  menu,
  onChoose,
  onHover,
  renderItem,
  target,
  title,
}: SuggestionPopupProps<I>) {
  const active = menu ? optionId(id, menu.active) : null;
  useEffect(() => {
    if (!target) {
      return;
    }
    target.setAttribute("aria-autocomplete", "list");
    target.setAttribute("aria-expanded", active ? "true" : "false");
    if (active) {
      target.setAttribute("aria-controls", id);
      target.setAttribute("aria-activedescendant", active);
    } else {
      target.removeAttribute("aria-controls");
      target.removeAttribute("aria-activedescendant");
    }
  }, [active, id, target]);

  if (!(menu?.rect && typeof document !== "undefined")) {
    return null;
  }
  return createPortal(
    <div className="fixed z-50 w-72" style={position(menu.rect)}>
      <MenuListbox
        activeIndex={menu.active}
        id={id}
        itemKey={itemKey}
        items={menu.items}
        onChoose={onChoose}
        onHover={onHover}
        renderItem={renderItem}
        slot="suggestion-popup"
        title={title}
      />
    </div>,
    document.body
  );
}

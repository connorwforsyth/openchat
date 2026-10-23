"use client";

import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import { useCallback, useMemo, useRef, useState } from "react";

import type { MenuItem } from "../options";
import { menuKeyAction, moveActive, slashStage } from "../triggers";

// TipTap's Suggestion utility finds `/query` and `@query` and drives a
// renderer through lifecycle hooks. This hook is that renderer for both
// triggers, which open the same menu: it mirrors the plugin's state into
// React so SuggestionMenu can draw it, and answers the plugin's key events.
// Focus never leaves the editor.

/** What the open menu lists: everything, or after `/open`, files to open. */
export type MenuList = "files" | "menu";

export interface OpenMenu {
  readonly items: readonly MenuItem[];
  readonly list: MenuList;
  /** Runs the plugin's command for the item at this index. */
  readonly select: (index: number) => void;
}

interface MenuSnapshot {
  readonly active: number;
  readonly menu: OpenMenu | null;
  readonly query: string;
}

const CLOSED: MenuSnapshot = { active: 0, menu: null, query: "" };

/**
 * Where each menu's items come from, for a query. The plugins ask only when
 * the text changes; a refresh asks again when the host's lists change.
 */
export type SuggestionSource = (query: string) => readonly MenuItem[];

/** Redraws the open menu from new sources, for the query it shows. */
type Requery = (source: SuggestionSource) => void;

type Renderer<I, S> = () => {
  onExit: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onStart: (props: SuggestionProps<I, S>) => void;
  onUpdate: (props: SuggestionProps<I, S>) => void;
};

const openMenu = (props: SuggestionProps<MenuItem, MenuItem>): OpenMenu => ({
  items: props.items,
  list: slashStage(props.query).stage === "open" ? "files" : "menu",
  select: (index) => {
    const item = props.items[index];
    if (item) {
      props.command(item);
    }
  },
});

/**
 * TipTap fetches a query's items asynchronously and, until they land,
 * reports the query with no items (`loading`). Shown as is, the menu would
 * close for that moment, and an Enter typed in it would send the message
 * instead of choosing (061's e2e: `/new-file` then Enter). So a loading
 * update keeps the last list it had, with the new range, so choosing
 * replaces the whole query. Before any list has landed there is nothing to
 * keep, and the plugin's first answer follows within a tick.
 */
export const keepWhileLoading = <I, S>(
  render: (props: SuggestionProps<I, S>) => void
) => {
  let items: I[] | null = null;
  const onProps = (props: SuggestionProps<I, S>) => {
    if (!props.loading) {
      ({ items } = props);
      render(props);
    } else if (items !== null) {
      render({ ...props, items });
    }
  };
  onProps.reset = () => {
    items = null;
  };
  return onProps;
};

export function useSuggestionMenus() {
  const [snapshot, setSnapshot] = useState<MenuSnapshot>(CLOSED);
  // Plugin callbacks run outside React's render and read the latest state here.
  const latest = useRef<MenuSnapshot>(CLOSED);
  // Set while a plugin has a suggestion active, from start to exit, even
  // when its query matches nothing and no menu shows: that's when a list
  // landing late (065) has something to add.
  const requery = useRef<Requery | null>(null);

  const update = useCallback((next: MenuSnapshot) => {
    latest.current = next;
    setSnapshot(next);
  }, []);

  const show = useCallback(
    (menu: OpenMenu, query: string) => {
      const previous = latest.current;
      // A new query starts again at the top; the same one keeps its place.
      const sameQuery =
        previous.menu?.list === menu.list && previous.query === query;
      update({
        active: sameQuery
          ? Math.min(previous.active, Math.max(0, menu.items.length - 1))
          : 0,
        menu: menu.items.length > 0 ? menu : null,
        query,
      });
    },
    [update]
  );

  const close = useCallback(() => update(CLOSED), [update]);

  const hover = useCallback(
    (index: number) => update({ ...latest.current, active: index }),
    [update]
  );

  const onKeyDown = useCallback(
    ({ event }: SuggestionKeyDownProps): boolean => {
      const { active, menu } = latest.current;
      const action = menuKeyAction(event);
      if (menu === null || action === undefined) {
        return false;
      }
      switch (action) {
        case "choose":
          menu.select(active);
          return true;
        case "dismiss":
          // The plugin exits on Escape by itself, which calls onExit.
          return true;
        case "next":
        case "previous":
          update({
            ...latest.current,
            active: moveActive(active, menu.items.length, action),
          });
          return true;
        default:
          return action satisfies never;
      }
    },
    [update]
  );

  const renderer = useMemo(
    (): Renderer<MenuItem, MenuItem> => () => {
      const render = keepWhileLoading<MenuItem, MenuItem>((props) =>
        show(openMenu(props), props.query)
      );
      const onProps = (props: SuggestionProps<MenuItem, MenuItem>) => {
        requery.current = (source) =>
          render({
            ...props,
            items: [...source(props.query)],
            loading: false,
          });
        render(props);
      };
      return {
        onExit: () => {
          requery.current = null;
          render.reset();
          close();
        },
        onKeyDown,
        onStart: onProps,
        onUpdate: onProps,
      };
    },
    [close, onKeyDown, show]
  );

  const isOpen = useCallback(() => latest.current.menu !== null, []);

  /**
   * The plugins ask for items only when the text changes, so a list that
   * lands after the last keystroke (the workspace listing, 065) would stay
   * out of an open menu until the next one. The host calls this when its
   * lists change: an active suggestion is filtered again for its query, and
   * the menu opens, grows or shrinks to match.
   */
  const refresh = useCallback((source: SuggestionSource) => {
    requery.current?.(source);
  }, []);

  return {
    active: snapshot.active,
    close,
    hover,
    /** For key handlers outside the plugins: is a menu showing right now? */
    isOpen,
    menu: snapshot.menu,
    refresh,
    renderer,
  };
}

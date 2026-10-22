"use client";

import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { useCallback, useMemo, useRef, useState } from "react";

import { menuKeyAction, moveActive } from "../triggers";
import { keepWhileLoading } from "./use-suggestion-menus";

// One TipTap Suggestion plugin's menu, for editors outside the composer
// (the document's block menu, the library's snippet editors). The same
// keys as the composer (`menuKeyAction`), the same loading rule
// (`keepWhileLoading`), and the caret's position so the popup can sit
// beside it.

export interface PopupMenu<I> {
  readonly active: number;
  readonly items: readonly I[];
  readonly query: string;
  /** Where the trigger is on screen; `null` when the plugin can't say. */
  readonly rect: DOMRect | null;
}

interface Snapshot<I> {
  readonly menu: PopupMenu<I> | null;
  /** Runs the plugin's command for an item (replaces the trigger and query). */
  readonly pick: ((item: I) => void) | null;
}

const closed = <I>(): Snapshot<I> => ({ menu: null, pick: null });

export type SuggestionRender<I> = NonNullable<
  SuggestionOptions<I, I>["render"]
>;

export function useSuggestionPopup<I>() {
  const [snapshot, setSnapshot] = useState<Snapshot<I>>(closed);
  // Plugin callbacks run outside React's render and read the latest here.
  const latest = useRef<Snapshot<I>>(closed());

  const update = useCallback((next: Snapshot<I>) => {
    latest.current = next;
    setSnapshot(next);
  }, []);

  const choose = useCallback((index: number) => {
    const { menu, pick } = latest.current;
    const item = menu?.items[index];
    if (item !== undefined && pick) {
      pick(item);
    }
  }, []);

  const hover = useCallback(
    (index: number) => {
      const { menu } = latest.current;
      if (menu) {
        update({ ...latest.current, menu: { ...menu, active: index } });
      }
    },
    [update]
  );

  const onKeyDown = useCallback(
    ({ event }: SuggestionKeyDownProps): boolean => {
      const { menu } = latest.current;
      const action = menuKeyAction(event);
      if (menu === null || action === undefined) {
        return false;
      }
      switch (action) {
        case "choose":
          choose(menu.active);
          return true;
        case "dismiss":
          // The plugin exits on Escape by itself, which calls onExit.
          return true;
        case "next":
        case "previous":
          update({
            ...latest.current,
            menu: {
              ...menu,
              active: moveActive(menu.active, menu.items.length, action),
            },
          });
          return true;
        default:
          return action satisfies never;
      }
    },
    [choose, update]
  );

  const render = useMemo(
    (): SuggestionRender<I> => () => {
      const show = keepWhileLoading<I, I>((props: SuggestionProps<I, I>) => {
        const previous = latest.current.menu;
        // A new query starts again at the top; the same one keeps its place.
        const active =
          previous?.query === props.query
            ? Math.min(previous.active, Math.max(0, props.items.length - 1))
            : 0;
        update({
          menu:
            props.items.length > 0
              ? {
                  active,
                  items: props.items,
                  query: props.query,
                  rect: props.clientRect?.() ?? null,
                }
              : null,
          pick: props.command,
        });
      });
      return {
        onExit: () => {
          show.reset();
          update(closed());
        },
        onKeyDown,
        onStart: show,
        onUpdate: show,
      };
    },
    [onKeyDown, update]
  );

  return { choose, hover, menu: snapshot.menu, render };
}

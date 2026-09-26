"use client";

import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import { useCallback, useMemo, useRef, useState } from "react";

import type { Suggestion } from "../components/suggestion-menu";
import type { MentionAttrs } from "../editor/extensions";
import type { MentionCandidate, PromptOption } from "../schemas";
import { menuKeyAction, moveActive } from "../triggers";

// TipTap's Suggestion utility finds `/query` and `@query` and drives a
// renderer through lifecycle hooks. This hook is that renderer for both
// menus: it mirrors the plugin's state into React so SuggestionMenu can draw
// it, and answers the plugin's key events. Focus never leaves the editor.

export interface OpenMenu {
  readonly char: "/" | "@";
  readonly items: readonly Suggestion[];
  /** Runs the plugin's command for the item at this index. */
  readonly select: (index: number) => void;
}

interface MenuSnapshot {
  readonly active: number;
  readonly menu: OpenMenu | null;
  readonly query: string;
}

const CLOSED: MenuSnapshot = { active: 0, menu: null, query: "" };

type Renderer<I, S> = () => {
  onExit: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onStart: (props: SuggestionProps<I, S>) => void;
  onUpdate: (props: SuggestionProps<I, S>) => void;
};

const slashMenu = (
  props: SuggestionProps<PromptOption, PromptOption>
): OpenMenu => ({
  char: "/",
  items: props.items.map((prompt) => ({ kind: "prompt", prompt })),
  select: (index) => {
    const prompt = props.items[index];
    if (prompt) {
      props.command(prompt);
    }
  },
});

const mentionMenu = (
  props: SuggestionProps<MentionCandidate, MentionAttrs>
): OpenMenu => ({
  char: "@",
  items: props.items.map((candidate) => ({ candidate, kind: "mention" })),
  select: (index) => {
    const candidate = props.items[index];
    if (candidate) {
      const { id, kind, label } = candidate;
      props.command({ id, kind, label });
    }
  },
});

export function useSuggestionMenus() {
  const [snapshot, setSnapshot] = useState<MenuSnapshot>(CLOSED);
  // Plugin callbacks run outside React's render and read the latest state here.
  const latest = useRef<MenuSnapshot>(CLOSED);

  const update = useCallback((next: MenuSnapshot) => {
    latest.current = next;
    setSnapshot(next);
  }, []);

  const show = useCallback(
    (menu: OpenMenu, query: string) => {
      const previous = latest.current;
      // A new query starts again at the top; the same one keeps its place.
      const sameQuery =
        previous.menu?.char === menu.char && previous.query === query;
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

  const slashRenderer = useMemo(
    (): Renderer<PromptOption, PromptOption> => () => ({
      onExit: close,
      onKeyDown,
      onStart: (props) => show(slashMenu(props), props.query),
      onUpdate: (props) => show(slashMenu(props), props.query),
    }),
    [close, onKeyDown, show]
  );

  const mentionRenderer = useMemo(
    (): Renderer<MentionCandidate, MentionAttrs> => () => ({
      onExit: close,
      onKeyDown,
      onStart: (props) => show(mentionMenu(props), props.query),
      onUpdate: (props) => show(mentionMenu(props), props.query),
    }),
    [close, onKeyDown, show]
  );

  const isOpen = useCallback(() => latest.current.menu !== null, []);

  return {
    active: snapshot.active,
    close,
    hover,
    /** For key handlers outside the plugins: is a menu showing right now? */
    isOpen,
    mentionRenderer,
    menu: snapshot.menu,
    slashRenderer,
  };
}

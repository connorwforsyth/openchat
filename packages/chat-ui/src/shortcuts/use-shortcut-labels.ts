"use client";

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

import type { ShortcutId } from "./registry";

/** What each shortcut does, translated: for the `?` help, tooltips and the palette. */
export const useShortcutLabels = (): Readonly<Record<ShortcutId, string>> => {
  const { t } = useLingui();
  return useMemo(
    () => ({
      "branch.next": t`Next branch`,
      "branch.prev": t`Previous branch`,
      "chat.new": t`New chat`,
      "chat.next": t`Next chat`,
      "chat.prev": t`Previous chat`,
      "composer.focus": t`Focus the message box`,
      help: t`Keyboard shortcuts`,
      "palette.open": t`Search and commands`,
      "panel.artifacts": t`Artifacts panel`,
      "panel.sandbox": t`Sandbox panel`,
      "sidebar.toggle": t`Toggle sidebar`,
    }),
    [t]
  );
};

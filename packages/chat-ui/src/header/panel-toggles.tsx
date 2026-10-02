"use client";

import { useLingui } from "@lingui/react/macro";
import { AppWindowIcon, FolderIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { type ReactNode, useCallback } from "react";

import type { PanelHalf } from "../model/workspace";

/**
 * The header's ways into the right panel (137, after D14's one Workspace
 * toggle): Files opens it on the chat's files, Browser on its browser.
 * Each closes the panel when its half is the one showing and switches to
 * its half otherwise. Artifacts are in the files' list (and on A).
 */
export function PanelToggles({
  filesHint,
  onToggle,
  shown,
}: {
  /** The Files shortcut, for its tooltip. */
  readonly filesHint?: ReactNode;
  readonly onToggle: (half: PanelHalf) => void;
  /** The half the panel is open on; `null` when it's closed. */
  readonly shown: PanelHalf | null;
}) {
  const { t } = useLingui();
  return (
    <>
      <HalfToggle
        half="files"
        hint={filesHint}
        icon={<FolderIcon aria-hidden />}
        label={t`Files`}
        onToggle={onToggle}
        shown={shown}
      />
      <HalfToggle
        half="browser"
        icon={<AppWindowIcon aria-hidden />}
        label={t`Browser`}
        onToggle={onToggle}
        shown={shown}
      />
    </>
  );
}

function HalfToggle({
  half,
  hint,
  icon,
  label,
  onToggle,
  shown,
}: {
  readonly half: PanelHalf;
  readonly hint?: ReactNode;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onToggle: (half: PanelHalf) => void;
  readonly shown: PanelHalf | null;
}) {
  const toggle = useCallback(() => onToggle(half), [half, onToggle]);
  const pressed = shown === half;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={pressed}
            className="aria-pressed:bg-muted"
            onClick={toggle}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

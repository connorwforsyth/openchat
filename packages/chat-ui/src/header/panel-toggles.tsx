"use client";

import { useLingui } from "@lingui/react/macro";
import { AppWindowIcon, FolderIcon, ShapesIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback } from "react";

import type { WorkspaceSection } from "../model/layout";

/** Above this the badge says "99+". */
const MAX_COUNT = 99;

/**
 * The header's ways into the right panel (137, after D14's one Workspace
 * toggle; 171 brought Artifacts back): Files opens it on the chat's files,
 * Browser on its browser, Artifacts on the chat's artifacts. Each closes the
 * panel when its section is the one showing and switches to it otherwise.
 */
export function PanelToggles({
  artifactCount = 0,
  artifactsHint,
  filesHint,
  freshArtifact = false,
  onToggle,
  shown,
}: {
  /** The chat's artifacts, for the badge on Artifacts. */
  readonly artifactCount?: number;
  /** The Artifacts shortcut, for its tooltip. */
  readonly artifactsHint?: ReactNode;
  /** The Files shortcut, for its tooltip. */
  readonly filesHint?: ReactNode;
  /** An artifact arrived that the person hasn't looked at yet. */
  readonly freshArtifact?: boolean;
  readonly onToggle: (section: WorkspaceSection) => void;
  /** The section the panel is open on; `null` when it's closed. */
  readonly shown: WorkspaceSection | null;
}) {
  const { t } = useLingui();
  const count = artifactCount > MAX_COUNT ? `${MAX_COUNT}+` : artifactCount;
  let artifactsLabel = t`Artifacts`;
  if (freshArtifact) {
    artifactsLabel = t`Artifacts (${artifactCount}), new artifact`;
  } else if (artifactCount > 0) {
    artifactsLabel = t`Artifacts (${artifactCount})`;
  }
  return (
    <>
      <SectionToggle
        badge={
          artifactCount === 0 ? null : (
            // Appears at once and never pulses (D28): the dot is the cue.
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-medium text-[0.625rem] tabular-nums leading-none",
                freshArtifact
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
              data-fresh={freshArtifact ? "" : undefined}
              data-slot="artifact-count"
            >
              {count}
            </span>
          )
        }
        hint={artifactsHint}
        icon={<ShapesIcon aria-hidden />}
        label={artifactsLabel}
        onToggle={onToggle}
        section="artifacts"
        shown={shown}
        tooltip={freshArtifact ? t`Artifacts: new artifact` : t`Artifacts`}
      />
      <SectionToggle
        hint={filesHint}
        icon={<FolderIcon aria-hidden />}
        label={t`Files`}
        onToggle={onToggle}
        section="files"
        shown={shown}
      />
      <SectionToggle
        icon={<AppWindowIcon aria-hidden />}
        label={t`Browser`}
        onToggle={onToggle}
        section="browser"
        shown={shown}
      />
    </>
  );
}

function SectionToggle({
  badge,
  hint,
  icon,
  label,
  onToggle,
  section,
  shown,
  tooltip = label,
}: {
  readonly badge?: ReactNode;
  readonly hint?: ReactNode;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onToggle: (section: WorkspaceSection) => void;
  readonly section: WorkspaceSection;
  readonly shown: WorkspaceSection | null;
  readonly tooltip?: string;
}) {
  const toggle = useCallback(() => onToggle(section), [onToggle, section]);
  const pressed = shown === section;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={pressed}
            className="relative aria-pressed:bg-muted"
            onClick={toggle}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        {icon}
        {badge}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tooltip}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

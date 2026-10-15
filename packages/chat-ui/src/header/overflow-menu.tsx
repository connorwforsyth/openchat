"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  AppWindowIcon,
  EllipsisIcon,
  FolderIcon,
  LinkIcon,
  ShapesIcon,
  UserPlusIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useToastManager } from "@workspace/ui/components/toast";
import { useCallback } from "react";

import type { WorkspaceSection } from "../model/layout";

/** How long "Link copied" stays: long enough to read. */
const COPIED_TOAST_MS = 2000;

export interface HeaderOverflowMenuProps {
  readonly onCopyLink?: () => Promise<void> | void;
  readonly onInvite?: () => void;
  /** Artifacts, Files or the browser, as the wide header's toggles (137, 171). */
  readonly onTogglePanel: (section: WorkspaceSection) => void;
  /** Nothing to share before the first message. */
  readonly shareDisabled?: boolean;
  /** The section the panel is open on; `null` when it's closed. */
  readonly shown: WorkspaceSection | null;
}

/**
 * The header's end on a narrow screen, where Share and the Artifacts, Files
 * and Browser toggles don't fit beside the title: all in one menu.
 * Needs the shell's toast provider.
 */
export function HeaderOverflowMenu({
  onCopyLink,
  onInvite,
  onTogglePanel,
  shareDisabled = false,
  shown,
}: HeaderOverflowMenuProps) {
  const { t } = useLingui();
  const { add } = useToastManager();
  const copy = useCallback(async () => {
    await onCopyLink?.();
    add({ priority: "low", timeout: COPIED_TOAST_MS, title: t`Link copied` });
  }, [add, onCopyLink, t]);
  const share = Boolean(onInvite || onCopyLink);
  const toggleArtifacts = useCallback(
    () => onTogglePanel("artifacts"),
    [onTogglePanel]
  );
  const toggleFiles = useCallback(
    () => onTogglePanel("files"),
    [onTogglePanel]
  );
  const toggleBrowser = useCallback(
    () => onTogglePanel("browser"),
    [onTogglePanel]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label={t`More actions`} size="icon-sm" variant="ghost" />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={shown === "artifacts"}
            closeOnClick
            onCheckedChange={toggleArtifacts}
          >
            <ShapesIcon aria-hidden />
            <Trans>Artifacts</Trans>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={shown === "files"}
            closeOnClick
            onCheckedChange={toggleFiles}
          >
            <FolderIcon aria-hidden />
            <Trans>Files</Trans>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={shown === "browser"}
            closeOnClick
            onCheckedChange={toggleBrowser}
          >
            <AppWindowIcon aria-hidden />
            <Trans>Browser</Trans>
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        {share ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {onInvite ? (
                <DropdownMenuItem disabled={shareDisabled} onClick={onInvite}>
                  <UserPlusIcon aria-hidden />
                  <Trans>Invite people…</Trans>
                </DropdownMenuItem>
              ) : null}
              {onCopyLink ? (
                <DropdownMenuItem
                  aria-label={t`Copy link to this chat`}
                  disabled={shareDisabled}
                  onClick={copy}
                >
                  <LinkIcon aria-hidden />
                  <Trans>Copy link</Trans>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

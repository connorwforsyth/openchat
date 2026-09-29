"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  EllipsisIcon,
  LinkIcon,
  PanelRightIcon,
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
import { type ReactNode, useCallback } from "react";

import { LockedContextGroup } from "./share-menu";

/** How long "Link copied" stays: long enough to read. */
const COPIED_TOAST_MS = 2000;

export interface HeaderOverflowMenuProps {
  /** The chat's context once it's locked, as in the Share menu. */
  readonly lockedContext?: ReactNode;
  readonly onCopyLink?: () => Promise<void> | void;
  readonly onInvite?: () => void;
  readonly onToggleWorkspace: () => void;
  /** Nothing to share before the first message. */
  readonly shareDisabled?: boolean;
  readonly workspaceOpen: boolean;
}

/**
 * The header's end on a narrow screen, where Share and the Workspace toggle
 * don't fit beside the title: both in one menu, plus the locked context.
 * Needs the shell's toast provider.
 */
export function HeaderOverflowMenu({
  lockedContext,
  onCopyLink,
  onInvite,
  onToggleWorkspace,
  shareDisabled = false,
  workspaceOpen,
}: HeaderOverflowMenuProps) {
  const { t } = useLingui();
  const { add } = useToastManager();
  const copy = useCallback(async () => {
    await onCopyLink?.();
    add({ priority: "low", timeout: COPIED_TOAST_MS, title: t`Link copied` });
  }, [add, onCopyLink, t]);
  const share = Boolean(onInvite || onCopyLink);

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
            checked={workspaceOpen}
            closeOnClick
            onCheckedChange={onToggleWorkspace}
          >
            <PanelRightIcon aria-hidden />
            <Trans>Workspace</Trans>
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
        {lockedContext ? (
          <>
            <DropdownMenuSeparator />
            <LockedContextGroup>{lockedContext}</LockedContextGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

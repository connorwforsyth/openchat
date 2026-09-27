"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  EllipsisIcon,
  FileTextIcon,
  LinkIcon,
  TerminalIcon,
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

/** How long "Link copied" stays: long enough to read. */
const COPIED_TOAST_MS = 2000;

export interface HeaderOverflowMenuProps {
  readonly artifactsOpen: boolean;
  readonly onCopyLink?: () => Promise<void> | void;
  readonly onInvite?: () => void;
  readonly onToggleArtifacts: () => void;
  /** Absent when sandboxes are off. */
  readonly onToggleSandbox?: () => void;
  readonly sandboxOpen: boolean;
  /** Nothing to share before the first message. */
  readonly shareDisabled?: boolean;
}

/**
 * The header's secondary actions on a narrow screen, where the Share menu,
 * the sandbox pill and the artifacts button don't fit: the panels and the
 * share actions in one menu. Needs the shell's toast provider.
 */
export function HeaderOverflowMenu({
  artifactsOpen,
  onCopyLink,
  onInvite,
  onToggleArtifacts,
  onToggleSandbox,
  sandboxOpen,
  shareDisabled = false,
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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {onToggleSandbox ? (
            <DropdownMenuCheckboxItem
              checked={sandboxOpen}
              closeOnClick
              onCheckedChange={onToggleSandbox}
            >
              <TerminalIcon aria-hidden />
              <Trans>Sandbox panel</Trans>
            </DropdownMenuCheckboxItem>
          ) : null}
          <DropdownMenuCheckboxItem
            checked={artifactsOpen}
            closeOnClick
            onCheckedChange={onToggleArtifacts}
          >
            <FileTextIcon aria-hidden />
            <Trans>Artifacts panel</Trans>
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

"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ConversationPermission,
  Participant,
} from "@workspace/contract/schemas/conversations";
import { CheckIcon, LinkIcon, ShareIcon, UserPlusIcon } from "@workspace/icons";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { motionMs } from "@workspace/ui/lib/motion";
import { useCallback, useEffect, useState } from "react";

import { initialsOf } from "../model/people";

const MAX_AVATARS = 3;
/** How long "Link copied" stays: long enough to read, then back to Share. */
const COPIED_MS = 1500 + motionMs.exit;

function PermissionLabel({
  permission,
}: {
  readonly permission: ConversationPermission;
}) {
  switch (permission) {
    case "owner":
      return <Trans>Owner</Trans>;
    case "editor":
      return <Trans>Editor</Trans>;
    case "viewer":
      return <Trans>Viewer</Trans>;
    default:
      return permission satisfies never;
  }
}

function PersonAvatar({
  person,
  size = "sm",
}: {
  readonly person: Participant["user"];
  readonly size?: "sm" | "default";
}) {
  return (
    <Avatar size={size}>
      {person.image ? <AvatarImage alt="" src={person.image} /> : null}
      <AvatarFallback>{initialsOf(person.name)}</AvatarFallback>
    </Avatar>
  );
}

/** Who's in the chat, as overlapping avatars (D25). */
export function Participants({
  participants,
}: {
  readonly participants: readonly Participant[];
}) {
  const { t } = useLingui();
  if (participants.length < 2) {
    return null;
  }
  const shown = participants.slice(0, MAX_AVATARS);
  const more = participants.length - shown.length;
  const names = participants.map((person) => person.user.name).join(", ");
  return (
    <AvatarGroup
      aria-label={t`People in this chat: ${names}`}
      className="hidden md:flex"
      role="img"
    >
      {shown.map((person) => (
        <PersonAvatar key={person.user.id} person={person.user} />
      ))}
      {more > 0 ? <AvatarGroupCount>+{more}</AvatarGroupCount> : null}
    </AvatarGroup>
  );
}

export interface ShareMenuProps {
  /** Nothing to share before the first message. */
  readonly disabled?: boolean;
  /** Copies the chat's link; resolves once it's on the clipboard. */
  readonly onCopyLink?: () => Promise<void> | void;
  readonly onInvite?: () => void;
  readonly participants: readonly Participant[];
}

/** Share: who has access, invite people, copy a link (all through callbacks). */
export function ShareMenu({
  disabled,
  onCopyLink,
  onInvite,
  participants,
}: ShareMenuProps) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    await onCopyLink?.();
    setCopied(true);
  }, [onCopyLink]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={<Button size="sm" variant="ghost" />}
      >
        {copied ? (
          <CheckIcon aria-hidden data-icon="inline-start" />
        ) : (
          <ShareIcon aria-hidden data-icon="inline-start" />
        )}
        <span aria-live="polite">
          {copied ? <Trans>Link copied</Trans> : <Trans>Share</Trans>}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>People in this chat</Trans>
          </DropdownMenuLabel>
          {participants.map((person) => (
            <div
              className="flex items-center gap-2 px-1.5 py-1 text-sm"
              key={person.user.id}
            >
              <PersonAvatar person={person.user} />
              <span className="min-w-0 flex-1 truncate">
                {person.user.name}
              </span>
              <span className="text-muted-foreground text-xs">
                <PermissionLabel permission={person.permission} />
              </span>
            </div>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {onInvite ? (
            <DropdownMenuItem onClick={onInvite}>
              <UserPlusIcon aria-hidden />
              <Trans>Invite people…</Trans>
            </DropdownMenuItem>
          ) : null}
          {onCopyLink ? (
            <DropdownMenuItem
              aria-label={t`Copy link to this chat`}
              onClick={copy}
            >
              <LinkIcon aria-hidden />
              <Trans>Copy link</Trans>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

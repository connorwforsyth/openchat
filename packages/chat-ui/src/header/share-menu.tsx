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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
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
  className,
  person,
}: {
  readonly className?: string;
  readonly person: Participant["user"];
}) {
  return (
    <Avatar className={className} size="sm">
      {person.image ? <AvatarImage alt="" src={person.image} /> : null}
      <AvatarFallback>{initialsOf(person.name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Who's in the chat as overlapping avatars (D25), inside the Share button.
 * Decorative there: the button is named "Share" and its menu lists everyone
 * by name.
 */
function ParticipantAvatars({
  participants,
}: {
  readonly participants: readonly Participant[];
}) {
  const shown = participants.slice(0, MAX_AVATARS);
  const more = participants.length - shown.length;
  return (
    <AvatarGroup aria-hidden className="-space-x-1.5">
      {shown.map((person) => (
        <PersonAvatar
          className="size-5"
          key={person.user.id}
          person={person.user}
        />
      ))}
      {more > 0 ? (
        <AvatarGroupCount className="size-5 text-[0.625rem]">
          +{more}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}

function TriggerIcon({
  copied,
  shared,
}: {
  readonly copied: boolean;
  readonly shared: boolean;
}) {
  if (copied) {
    return <CheckIcon aria-hidden data-icon="inline-start" />;
  }
  // The avatars stand in for the icon once other people are in the chat.
  return shared ? null : <ShareIcon aria-hidden data-icon="inline-start" />;
}

export interface ShareMenuProps {
  /** Nothing to share before the first message. */
  readonly disabled?: boolean;
  /** Copies the chat's link; resolves once it's on the clipboard. */
  readonly onCopyLink?: () => Promise<void> | void;
  readonly onInvite?: () => void;
  readonly participants: readonly Participant[];
}

/**
 * Share (D14): who has access, invite people and copy a link (all through
 * callbacks). The chat's context sits by the title (113). The people in the chat show as
 * avatars on the button itself.
 */
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
  const shared = participants.length > 1;
  const actions = Boolean(onInvite || onCopyLink);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={<Button className="rounded-full" size="sm" variant="ghost" />}
      >
        {shared ? <ParticipantAvatars participants={participants} /> : null}
        <TriggerIcon copied={copied} shared={shared} />
        <span aria-live="polite">
          {copied ? <Trans>Link copied</Trans> : <Trans>Share</Trans>}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>People in this chat</Trans>
          </DropdownMenuLabel>
          {participants.map((person) => (
            <Item className="px-1.5 py-1" key={person.user.id} size="xs">
              <ItemMedia>
                <PersonAvatar person={person.user} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="font-normal">
                  {person.user.name}
                </ItemTitle>
              </ItemContent>
              <ItemActions className="text-muted-foreground text-xs">
                <PermissionLabel permission={person.permission} />
              </ItemActions>
            </Item>
          ))}
        </DropdownMenuGroup>
        {actions ? (
          <>
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
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

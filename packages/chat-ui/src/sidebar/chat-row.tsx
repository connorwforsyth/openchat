"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import {
  ArchiveIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { memo, useCallback, useState } from "react";

import { RenameInput } from "./rename-input";

export type SidebarChat = Pick<
  Conversation,
  "id" | "lastMessageAt" | "pinned" | "title" | "updatedAt"
>;

export interface ChatRowProps {
  readonly active: boolean;
  readonly chat: SidebarChat;
  readonly onArchive: (chat: SidebarChat) => void;
  readonly onRename: (id: ConversationId, title: string) => void;
  readonly onSelect: (id: ConversationId) => void;
  readonly onTogglePin: (id: ConversationId, pinned: boolean) => void;
}

/** A chat in the sidebar; hover or focus shows its actions (rename, pin, archive). */
export const ChatRow = memo(function ChatRowInner({
  active,
  chat,
  onArchive,
  onRename,
  onSelect,
  onTogglePin,
}: ChatRowProps) {
  const { t } = useLingui();
  const [renaming, setRenaming] = useState(false);
  const title = chat.title ?? t`New chat`;

  const select = useCallback(() => onSelect(chat.id), [chat.id, onSelect]);
  const startRename = useCallback(() => setRenaming(true), []);
  const finishRename = useCallback(
    (next: string | null) => {
      setRenaming(false);
      if (next !== null) {
        onRename(chat.id, next);
      }
    },
    [chat.id, onRename]
  );
  const togglePin = useCallback(
    () => onTogglePin(chat.id, !chat.pinned),
    [chat.id, chat.pinned, onTogglePin]
  );
  const archive = useCallback(() => onArchive(chat), [chat, onArchive]);

  if (renaming) {
    return (
      <li className="px-0.5 py-0.5">
        <RenameInput initial={chat.title ?? ""} onDone={finishRename} />
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <button
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full min-w-0 items-center rounded-md ps-2 pe-8 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        )}
        data-chat-id={chat.id}
        onClick={select}
        type="button"
      >
        <span className="truncate">{title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Actions for ${title}`}
              className="absolute end-1 top-1 opacity-0 pointer-coarse:opacity-100 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={startRename}>
              <PencilIcon aria-hidden />
              <Trans>Rename</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={togglePin}>
              {chat.pinned ? (
                <>
                  <PinOffIcon aria-hidden />
                  <Trans>Unpin</Trans>
                </>
              ) : (
                <>
                  <PinIcon aria-hidden />
                  <Trans>Pin</Trans>
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={archive}>
              <ArchiveIcon aria-hidden />
              <Trans>Archive</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
});

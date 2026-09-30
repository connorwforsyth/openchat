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
import { memo, useCallback, useRef, useState } from "react";

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

// ChatGPT's rhythm (071): 36px rows (44px on touch), a clear active fill in
// both themes, and titles that fade out at the end rather than stopping at an
// ellipsis a button's width early. The ⋯ sits over the fade, which widens
// while it shows (hover, focus, its menu open, and always on touch).
const titleFade = cn(
  "ltr:mask-r-from-[calc(100%-1.5rem)] rtl:mask-l-from-[calc(100%-1.5rem)]",
  "ltr:group-hover/row:mask-r-from-[calc(100%-3rem)] ltr:group-hover/row:mask-r-to-[calc(100%-1.75rem)] rtl:group-hover/row:mask-l-from-[calc(100%-3rem)] rtl:group-hover/row:mask-l-to-[calc(100%-1.75rem)]",
  "ltr:group-focus-within/row:mask-r-from-[calc(100%-3rem)] ltr:group-focus-within/row:mask-r-to-[calc(100%-1.75rem)] rtl:group-focus-within/row:mask-l-from-[calc(100%-3rem)] rtl:group-focus-within/row:mask-l-to-[calc(100%-1.75rem)]",
  "ltr:group-data-menu-open/row:mask-r-from-[calc(100%-3rem)] ltr:group-data-menu-open/row:mask-r-to-[calc(100%-1.75rem)] rtl:group-data-menu-open/row:mask-l-from-[calc(100%-3rem)] rtl:group-data-menu-open/row:mask-l-to-[calc(100%-1.75rem)]",
  "ltr:pointer-coarse:mask-r-from-[calc(100%-3rem)] ltr:pointer-coarse:mask-r-to-[calc(100%-1.75rem)] rtl:pointer-coarse:mask-l-from-[calc(100%-3rem)] rtl:pointer-coarse:mask-l-to-[calc(100%-1.75rem)]"
);

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
  const [menuOpen, setMenuOpen] = useState(false);
  // The full title as a tooltip, only when the fade hides some of it.
  const [truncated, setTruncated] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  // Rename waits for its menu to finish closing: the menu hands focus back
  // as it goes, and an input focused before that would lose it at once.
  const renameAfterClose = useRef(false);
  const title = chat.title ?? t`New chat`;

  const select = useCallback(() => onSelect(chat.id), [chat.id, onSelect]);
  const measure = useCallback(() => {
    const element = titleRef.current;
    setTruncated(
      element !== null && element.scrollWidth > element.clientWidth + 1
    );
  }, []);
  const startRename = useCallback(() => {
    renameAfterClose.current = true;
  }, []);
  const onMenuOpenChangeComplete = useCallback((open: boolean) => {
    if (!open && renameAfterClose.current) {
      renameAfterClose.current = false;
      setRenaming(true);
    }
  }, []);
  // Focus goes to the rename input, not back to a trigger it replaces.
  const menuFinalFocus = useCallback(() => !renameAfterClose.current, []);
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
      <li className="flex h-9 pointer-coarse:h-11 items-center px-0.5">
        <RenameInput initial={chat.title ?? ""} onDone={finishRename} />
      </li>
    );
  }

  return (
    <li
      className="group/row relative"
      data-menu-open={menuOpen ? "" : undefined}
    >
      <button
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 pointer-coarse:h-11 w-full min-w-0 items-center rounded-lg px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active &&
            "bg-sidebar-foreground/8 font-medium hover:bg-sidebar-foreground/8"
        )}
        data-chat-id={chat.id}
        onClick={select}
        onFocus={measure}
        onPointerEnter={measure}
        title={truncated ? title : undefined}
        type="button"
      >
        <span
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap",
            titleFade
          )}
          ref={titleRef}
        >
          {title}
        </span>
      </button>
      <DropdownMenu
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={onMenuOpenChangeComplete}
      >
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Actions for ${title}`}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 pointer-coarse:opacity-100 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-44"
          finalFocus={menuFinalFocus}
        >
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

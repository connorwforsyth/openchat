"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { LibraryIcon, NewChatIcon, SearchIcon } from "@workspace/icons";
import { type ReactNode, useCallback, useMemo } from "react";

import { type DateGroup, groupChats } from "../model/date-groups";
import { useUndoToast } from "../shell/use-undo-toast";
import { ShortcutHint } from "../shortcuts/shortcut-hint";
import { AccountMenu, type AccountMenuProps } from "./account-menu";
import { ChatRow, type SidebarChat } from "./chat-row";

export interface ChatSidebarProps {
  readonly account: AccountMenuProps;
  readonly activeId: ConversationId | null;
  /** The org or brand at the top of the sidebar. */
  readonly brand?: ReactNode;
  readonly chats: readonly SidebarChat[];
  /** Where the library lives (ticket 017); a plain link. */
  readonly libraryHref?: string;
  /** The clock for date groups; defaults to now. */
  readonly now?: Date;
  /** Optimistic: hide it now; the undo toast calls `onRestore`. */
  readonly onArchive: (id: ConversationId) => void;
  readonly onNewChat: () => void;
  /** Opens the ⌘K palette (ticket 024). */
  readonly onOpenPalette?: () => void;
  readonly onRename: (id: ConversationId, title: string) => void;
  readonly onRestore: (id: ConversationId) => void;
  readonly onSelect: (id: ConversationId) => void;
  readonly onTogglePin: (id: ConversationId, pinned: boolean) => void;
  /** The sidebar toggle, at the end of the brand row (113). */
  readonly toggle?: ReactNode;
}

// Same rhythm as the chat rows (071): 36px, 44px on touch.
const navRowClass =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0";

function GroupHeading({ group }: { readonly group: DateGroup | "pinned" }) {
  switch (group) {
    case "pinned":
      return <Trans>Pinned</Trans>;
    case "today":
      return <Trans>Today</Trans>;
    case "yesterday":
      return <Trans>Yesterday</Trans>;
    case "previous7Days":
      return <Trans>Previous 7 days</Trans>;
    case "older":
      return <Trans>Older</Trans>;
    default:
      return group satisfies never;
  }
}

/** The Classic sidebar (ticket 009): actions, chats by date, account footer. */
export function ChatSidebar({
  account,
  activeId,
  brand,
  chats,
  libraryHref,
  now,
  onArchive,
  onNewChat,
  onOpenPalette,
  onRename,
  onRestore,
  onSelect,
  onTogglePin,
  toggle,
}: ChatSidebarProps) {
  const { t } = useLingui();
  const showUndo = useUndoToast();
  const grouped = useMemo(
    () => groupChats(chats, now ?? new Date()),
    [chats, now]
  );

  const archive = useCallback(
    (chat: SidebarChat) => {
      onArchive(chat.id);
      const title = chat.title ?? t`New chat`;
      showUndo({
        onUndo: () => onRestore(chat.id),
        title: t`Archived “${title}”`,
      });
    },
    [onArchive, onRestore, showUndo, t]
  );

  const sections = [
    ...(grouped.pinned.length > 0
      ? [{ group: "pinned" as const, items: grouped.pinned }]
      : []),
    ...grouped.groups,
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 ps-3 pe-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">{brand}</div>
        {toggle}
      </div>

      <nav aria-label={t`Primary`} className="flex flex-col gap-0.5 px-2">
        <button className={navRowClass} onClick={onNewChat} type="button">
          <NewChatIcon aria-hidden />
          <span className="flex-1">
            <Trans>New chat</Trans>
          </span>
          <ShortcutHint id="chat.new" />
        </button>
        {onOpenPalette ? (
          <button className={navRowClass} onClick={onOpenPalette} type="button">
            <SearchIcon aria-hidden />
            <span className="flex-1">
              <Trans>Search</Trans>
            </span>
            <ShortcutHint id="palette.open" />
          </button>
        ) : null}
        {libraryHref ? (
          <a className={navRowClass} href={libraryHref}>
            <LibraryIcon aria-hidden />
            <span className="flex-1">
              <Trans>Library</Trans>
            </span>
          </a>
        ) : null}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sections.length === 0 ? (
          <p className="px-2 pt-6 text-muted-foreground text-sm">
            <Trans>No chats yet. Start one and it shows up here.</Trans>
          </p>
        ) : (
          sections.map((section) => (
            <section
              aria-labelledby={`chat-group-${section.group}`}
              key={section.group}
            >
              <h3
                className="px-2 pt-5 pb-1.5 font-medium text-muted-foreground text-xs"
                id={`chat-group-${section.group}`}
              >
                <GroupHeading group={section.group} />
              </h3>
              <ul className="flex flex-col gap-px">
                {section.items.map((chat) => (
                  <ChatRow
                    active={chat.id === activeId}
                    chat={chat}
                    key={chat.id}
                    onArchive={archive}
                    onRename={onRename}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="shrink-0 border-sidebar-border border-t p-2">
        <AccountMenu {...account} />
      </div>
    </div>
  );
}

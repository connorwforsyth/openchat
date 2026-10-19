"use client";

import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  BotIcon,
  LibraryIcon,
  NewChatIcon,
  SearchIcon,
  ShapesIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useMemo } from "react";

import { needsAttention, nextNeedingAttention } from "../model/attention";
import { AccountMenu } from "./account-menu";
import type { ChatSidebarProps } from "./chat-sidebar";

// The collapsed sidebar (179): a 48px rail of icons rather than nothing, as
// in ChatGPT. It shows instantly (the toggle is keyboard-driven, so no
// animation), and the shell's peek still opens the full sidebar from its edge.
// The header's sidebar toggle, beside it, opens it again; a second toggle on
// the rail would sit under the desktop app's traffic lights.

export type SidebarRailProps = Pick<
  ChatSidebarProps,
  | "account"
  | "activeId"
  | "artifactsHref"
  | "chats"
  | "dot"
  | "dotFace"
  | "dotsHref"
  | "libraryHref"
  | "onNewChat"
  | "onOpenPalette"
  | "onSelect"
  | "signals"
>;

const railButton =
  "relative flex size-10 items-center justify-center rounded-lg text-sidebar-foreground outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-4";

function RailItem({
  children,
  href,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly href?: string;
  readonly label: string;
  readonly onClick?: () => void;
}) {
  return href ? (
    <a aria-label={label} className={railButton} href={href} title={label}>
      {children}
    </a>
  ) : (
    <button
      aria-label={label}
      className={railButton}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function SidebarRail({
  account,
  activeId,
  artifactsHref,
  chats,
  dot,
  dotFace,
  dotsHref,
  libraryHref,
  onNewChat,
  onOpenPalette,
  onSelect,
  signals,
}: SidebarRailProps) {
  const { t } = useLingui();
  const attention = useMemo(
    () =>
      needsAttention(
        chats.filter((chat) => chat.id !== dot?.conversationId),
        signals ?? new Map()
      ),
    [chats, dot, signals]
  );
  const waiting = attention.length;
  const dotId = dot?.conversationId;
  const openDot = useCallback(
    () => dotId && onSelect(dotId),
    [dotId, onSelect]
  );
  const openNext = useCallback(() => {
    const next = nextNeedingAttention(attention, activeId);
    if (next) {
      onSelect(next);
    }
  }, [activeId, attention, onSelect]);
  return (
    <nav
      aria-label={t`Sidebar rail`}
      className="flex h-full w-12 flex-col items-center gap-1 border-sidebar-border border-e bg-sidebar py-2"
      data-slot="sidebar-rail"
    >
      <RailItem label={t`New chat`} onClick={onNewChat}>
        <NewChatIcon aria-hidden />
      </RailItem>
      {onOpenPalette ? (
        <RailItem label={t`Search`} onClick={onOpenPalette}>
          <SearchIcon aria-hidden />
        </RailItem>
      ) : null}
      {libraryHref ? (
        <RailItem href={libraryHref} label={t`Library`}>
          <LibraryIcon aria-hidden />
        </RailItem>
      ) : null}
      {artifactsHref ? (
        <RailItem href={artifactsHref} label={t`Artifacts`}>
          <ShapesIcon aria-hidden />
        </RailItem>
      ) : null}
      {dotsHref && !dot ? (
        <RailItem href={dotsHref} label={t`Make your Dot`}>
          <BotIcon aria-hidden />
        </RailItem>
      ) : null}
      {dot ? (
        <RailItem label={t`Open your Dot`} onClick={openDot}>
          {dotFace ?? <BotIcon aria-hidden />}
        </RailItem>
      ) : null}
      {waiting > 0 ? (
        <RailItem
          label={t`${plural(waiting, { one: "# chat needs attention", other: "# chats need attention" })}`}
          onClick={openNext}
        >
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-medium text-primary-foreground text-xs tabular-nums"
            )}
          >
            {waiting}
          </span>
        </RailItem>
      ) : null}
      <div className="mt-auto">
        <AccountMenu {...account} compact />
      </div>
    </nav>
  );
}

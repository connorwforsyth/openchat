"use client";

import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  ClockIcon,
  LibraryIcon,
  MessageSquareIcon,
  ShapesIcon,
} from "@workspace/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useMemo } from "react";

import { needsAttention } from "../model/attention";
import { usePlatform } from "../shell/platform";
import { railButtonClass } from "../shell/sidebar-toggle";
import { AccountMenu } from "./account-menu";
import type { ChatSidebarProps } from "./chat-sidebar";

// The permanent icon rail (181), ChatGPT's "thin rail + panel": a 52px column
// of 36px buttons on a 44px pitch, always there on wide screens. The panel
// beside it (the chat list) collapses; the rail doesn't, and its first
// button, the sidebar toggle, stays put either way. It shows instantly
// (its toggle is a key, D28), and each button has a tooltip and a label.

/** Where the rail can point; the caller says which one is current. */
export type RailDestination =
  | "artifacts"
  | "chats"
  | "dot"
  | "library"
  | "scheduled";

export type SidebarRailProps = Pick<
  ChatSidebarProps,
  "account" | "artifactsHref" | "chats" | "dot" | "libraryHref" | "signals"
> & {
  /** The destination being shown; its button is filled. */
  readonly current: RailDestination;
  /** Chats: show the chat panel (opening it if collapsed). */
  readonly onShowChats: () => void;
  /** Where schedules live (the Dot's page for now). */
  readonly scheduledHref?: string;
  /** The sidebar toggle, the rail's first button; it never moves. */
  readonly toggle?: ReactNode;
};

function RailItem({
  active,
  badge,
  children,
  href,
  label,
  onClick,
}: {
  readonly active: boolean;
  /** An unread dot on the button's corner, with its own label. */
  readonly badge?: string;
  readonly children: ReactNode;
  readonly href?: string;
  readonly label: string;
  readonly onClick?: () => void;
}) {
  const { t } = useLingui();
  const fullLabel = badge ? t`${label}, ${badge}` : label;
  const content = (
    <>
      {children}
      {badge ? (
        <span
          aria-hidden
          className="absolute end-1.5 top-1.5 size-2 rounded-full bg-unread ring-2 ring-window"
          data-slot="rail-badge"
        />
      ) : null}
    </>
  );
  const common = {
    "aria-current": active ? ("page" as const) : undefined,
    "aria-label": fullLabel,
    className: railButtonClass,
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          href ? (
            <a {...common} href={href}>
              {content}
            </a>
          ) : (
            <button {...common} onClick={onClick} type="button">
              {content}
            </button>
          )
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarRail({
  account,
  artifactsHref,
  chats,
  current,
  dot,
  libraryHref,
  onShowChats,
  scheduledHref,
  signals,
  toggle,
}: SidebarRailProps) {
  const { t } = useLingui();
  const { platform } = usePlatform();
  const waiting = useMemo(
    () =>
      needsAttention(
        chats.filter((chat) => chat.id !== dot?.conversationId),
        signals ?? new Map()
      ).length,
    [chats, dot, signals]
  );
  return (
    <nav
      aria-label={t`Sidebar rail`}
      className={cn(
        // 11px down puts the first button's centre on the card's 48px top
        // row (4px inset + 1px border + 24px); gap-2 keeps a 44px pitch.
        "flex h-full w-13 flex-col items-center gap-2 bg-window pt-[11px] pb-2",
        // The desktop app's traffic lights sit at the top on macOS (117).
        platform === "mac" && "pt-12"
      )}
      data-slot="sidebar-rail"
    >
      {toggle}
      <RailItem
        active={current === "chats"}
        badge={
          waiting > 0
            ? t`${plural(waiting, { one: "# needs attention", other: "# need attention" })}`
            : undefined
        }
        label={t`Chats`}
        onClick={onShowChats}
      >
        <MessageSquareIcon aria-hidden />
      </RailItem>
      {scheduledHref ? (
        <RailItem
          active={current === "scheduled"}
          href={scheduledHref}
          label={t`Scheduled`}
        >
          <ClockIcon aria-hidden />
        </RailItem>
      ) : null}
      {libraryHref || artifactsHref ? (
        <div aria-hidden className="my-0.5 h-px w-6 bg-border" />
      ) : null}
      {libraryHref ? (
        <RailItem
          active={current === "library"}
          href={libraryHref}
          label={t`Library`}
        >
          <LibraryIcon aria-hidden />
        </RailItem>
      ) : null}
      {artifactsHref ? (
        <RailItem
          active={current === "artifacts"}
          href={artifactsHref}
          label={t`Artifacts`}
        >
          <ShapesIcon aria-hidden />
        </RailItem>
      ) : null}
      <div className="mt-auto">
        <AccountMenu {...account} compact />
      </div>
    </nav>
  );
}

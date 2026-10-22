"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { RunSignal } from "@workspace/chat-ui/model/attention";
import type { ChatSidebarProps } from "@workspace/chat-ui/sidebar/chat-sidebar";
import { navRowClass as rowClass } from "@workspace/chat-ui/sidebar/chat-sidebar";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import { ClockIcon, PlusIcon } from "@workspace/icons";
import { ShortcutKbd } from "@workspace/shortcuts/react/shortcut-kbd";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { DotAvatar } from "@/app/(app)/(pages)/dots/dot-avatar";
import { DOTS_REFRESH_MS } from "@/app/(app)/(pages)/dots/dot-home";
import { routes } from "@/lib/routes";

// Your Dot in the sidebar (172, 181): one row under the actions, like
// ChatGPT's "Your dot": its face, its name, its next scheduled run, an
// unread dot, and ⌘. on hover. A link, so it opens in a new tab too. With no
// Dot yet, the row offers to make one. There's one Dot per user (t/182), so
// there's no Dots list.

function UnreadMark({ dot }: { readonly dot: Dot }) {
  const { t } = useLingui();
  const count = dot.unreadRuns;
  return dot.unread ? (
    <span className="ms-auto flex items-center">
      <span aria-hidden className="size-2 rounded-full bg-unread" />
      <span className="sr-only">{t`${count} new`}</span>
    </span>
  ) : null;
}

function NextRun({
  at,
  emoji,
}: {
  readonly at: string | null;
  readonly emoji: string | null;
}) {
  const { i18n, t } = useLingui();
  if (at === null) {
    return null;
  }
  const when = i18n.date(new Date(at), {
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
  });
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3"
      title={t`Next run: ${when}`}
    >
      {emoji ? <span aria-hidden>{emoji}</span> : <ClockIcon aria-hidden />}
      <span className="sr-only">{t`Next run: ${when}`}</span>
    </span>
  );
}

function DotLink({
  active,
  dot,
}: {
  readonly active: boolean;
  readonly dot: Dot;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn(
        rowClass,
        "group/dot",
        active && "bg-sidebar-foreground/8 hover:bg-sidebar-foreground/8"
      )}
      href={routes.chat(dot.conversationId)}
    >
      <DotAvatar animated avatar={dot.avatar} size="xs" />
      <span className="min-w-0 flex-1 truncate">{dot.name}</span>
      <NextRun
        at={dot.nextRunAt}
        emoji={
          dot.schedules.find((each) => each.nextRunAt === dot.nextRunAt)
            ?.emoji ?? null
        }
      />
      <ShortcutKbd
        className="pointer-coarse:hidden opacity-0 transition-opacity duration-(--motion-fast) group-hover/dot:opacity-100 group-focus-visible/dot:opacity-100"
        id="dot.open"
      />
      <UnreadMark dot={dot} />
    </a>
  );
}

/** `top` (your Dot row) and the run state for `ChatSidebar`. */
export const useSidebarDots = (
  activeId: ConversationId | null
): Pick<
  ChatSidebarProps,
  "dot" | "dotFace" | "nextRuns" | "schedulesHref" | "signals" | "top"
> => {
  const { query } = useApi();
  const list = useQuery({
    ...query.dots.list.queryOptions({ input: {} }),
    refetchInterval: DOTS_REFRESH_MS,
  });
  return useMemo(() => {
    const all = list.data ?? [];
    const primary = all.find((dot) => dot.primary);
    const top = primary ? (
      <DotLink active={primary.conversationId === activeId} dot={primary} />
    ) : (
      <a className={rowClass} href={routes.dots}>
        <PlusIcon aria-hidden />
        <span className="flex-1">
          <Trans>Make your Dot</Trans>
        </span>
      </a>
    );
    // Schedules target a Dot's conversation today (#133): its next run shows
    // on that chat's row, and a Dot at work or failing needs attention.
    const nextRuns = new Map(
      all.flatMap((each) =>
        each.nextRunAt ? [[each.conversationId, each.nextRunAt] as const] : []
      )
    );
    const signals = new Map<ConversationId, RunSignal>(
      all.flatMap((each) =>
        each.status === "idle"
          ? []
          : [[each.conversationId, each.status] as const]
      )
    );
    return {
      dot: primary ? { conversationId: primary.conversationId } : undefined,
      dotFace: primary ? (
        <DotAvatar animated={false} avatar={primary.avatar} size="sm" />
      ) : undefined,
      nextRuns,
      schedulesHref: routes.schedules,
      signals,
      top,
    };
  }, [activeId, list.data]);
};

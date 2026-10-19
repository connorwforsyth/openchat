"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { RunSignal } from "@workspace/chat-ui/model/attention";
import type { ChatSidebarProps } from "@workspace/chat-ui/sidebar/chat-sidebar";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import { BotIcon, ClockIcon, PlusIcon } from "@workspace/icons";
import { ShortcutKbd } from "@workspace/shortcuts/react/shortcut-kbd";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { routes } from "@/lib/routes";

import { DotAvatar } from "./dot-avatar";
import { DOTS_REFRESH_MS } from "./dot-home";

// The Dots in the sidebar (172, 181): your primary Dot pinned at the very
// top, with its face, its next scheduled run and ⌘. to open it; the others in
// a short "Dots" list under the actions. Links, so they open in a new tab too.
// The engine (t/182) is moving to one Dot per user; until then this reads
// whatever `dots.list` returns.

// The sidebar's row rhythm (071): 36px, 44px on touch.
const rowClass =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0";

function UnreadMark({ dot }: { readonly dot: Dot }) {
  const { t } = useLingui();
  const count = dot.unreadRuns;
  return dot.unread ? (
    <span className="ms-auto flex items-center">
      <span aria-hidden className="size-2 rounded-full bg-primary" />
      <span className="sr-only">{t`${count} new`}</span>
    </span>
  ) : null;
}

function NextRun({ at }: { readonly at: string | null }) {
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
      <ClockIcon aria-hidden />
      <span className="sr-only">{t`Next run: ${when}`}</span>
    </span>
  );
}

function DotLink({
  active,
  dot,
  large,
}: {
  readonly active: boolean;
  readonly dot: Dot;
  readonly large?: boolean;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn(
        rowClass,
        large && "h-11 pointer-coarse:h-12",
        active && "bg-sidebar-foreground/5"
      )}
      href={routes.chat(dot.conversationId)}
    >
      <DotAvatar
        animated={large}
        avatar={dot.avatar}
        size={large ? "md" : "sm"}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate",
            dot.unread ? "font-semibold" : "font-medium"
          )}
        >
          {dot.name}
        </span>
        {large ? (
          <span className="truncate text-muted-foreground text-xs">
            @{dot.handle}
          </span>
        ) : null}
      </span>
      {large ? <NextRun at={dot.nextRunAt} /> : null}
      {large ? (
        <ShortcutKbd className="pointer-coarse:hidden" id="dot.open" />
      ) : null}
      <UnreadMark dot={dot} />
    </a>
  );
}

/** `top` and `dots` for `ChatSidebar`. */
export const useSidebarDots = (
  activeId: ConversationId | null
): Pick<ChatSidebarProps, "dot" | "dots" | "nextRuns" | "signals" | "top"> => {
  const { query } = useApi();
  const list = useQuery({
    ...query.dots.list.queryOptions({ input: {} }),
    refetchInterval: DOTS_REFRESH_MS,
  });
  return useMemo(() => {
    const all = list.data ?? [];
    const primary = all.find((dot) => dot.primary);
    const others = all.filter((dot) => dot !== primary);
    const top = primary ? (
      <DotLink
        active={primary.conversationId === activeId}
        dot={primary}
        large
      />
    ) : null;
    const dots = (
      <div className="flex flex-col gap-0.5">
        <a className={rowClass} href={routes.dots}>
          {all.length === 0 ? (
            <PlusIcon aria-hidden />
          ) : (
            <BotIcon aria-hidden />
          )}
          <span className="flex-1">
            {all.length === 0 ? (
              <Trans>Make your Dot</Trans>
            ) : (
              <Trans>Dots</Trans>
            )}
          </span>
        </a>
        {others.length > 0 ? (
          <ul className="flex flex-col gap-px ps-2">
            {others.map((dot) => (
              <li key={dot.id}>
                <DotLink active={dot.conversationId === activeId} dot={dot} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
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
      dots,
      nextRuns,
      signals,
      top,
    };
  }, [activeId, list.data]);
};

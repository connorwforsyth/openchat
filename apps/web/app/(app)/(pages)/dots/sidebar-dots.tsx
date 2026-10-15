"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import { BotIcon, PlusIcon } from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { routes } from "@/lib/routes";

import { DotAvatar } from "./dot-avatar";
import { DOTS_REFRESH_MS } from "./dot-home";

// The Dots in the sidebar (172): your primary Dot at the very top, with its
// face, opening straight into its chat; the others in a short "Dots" list
// under the actions. Links, so they open in a new tab too.

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
      <UnreadMark dot={dot} />
    </a>
  );
}

/** `top` and `dots` for `ChatSidebar`. */
export const useSidebarDots = (
  activeId: ConversationId | null
): { readonly dots: React.ReactNode; readonly top: React.ReactNode } => {
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
    return { dots, top };
  }, [activeId, list.data]);
};

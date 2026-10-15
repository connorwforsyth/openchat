"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { Dot } from "@workspace/contract/schemas/dots";
import { ArrowLeftIcon, PlusIcon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { routes } from "@/lib/routes";

import { DotAvatar } from "./dot-avatar";
import { DOTS_REFRESH_MS } from "./dot-home";
import { DotOnboarding } from "./onboarding";
import { useNextRunText } from "./schedule-text";

// The Dots page (172). The first visit makes your primary Dot (a short,
// friendly flow, then straight into its chat); after that it's everyone you
// have, each a face and a name that opens its conversation.

function DotCard({ dot }: { readonly dot: Dot }) {
  const { t } = useLingui();
  const nextText = useNextRunText();
  const { name } = dot;
  const next = dot.enabled ? nextText(dot.nextRunAt) : null;
  const said = dot.lastRun?.error ?? dot.lastRun?.snippet ?? null;
  return (
    <li>
      <a
        aria-label={t`Talk to ${name}`}
        className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        href={routes.chat(dot.conversationId)}
      >
        <div className="flex items-center gap-3">
          <DotAvatar animated={false} avatar={dot.avatar} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate text-base",
                dot.unread ? "font-semibold" : "font-medium"
              )}
            >
              {dot.name}
            </span>
            <span className="truncate text-muted-foreground text-sm">
              @{dot.handle}
            </span>
          </div>
          {dot.primary ? (
            <Badge variant="secondary">
              <Trans>Primary</Trans>
            </Badge>
          ) : null}
        </div>
        <p
          className={cn(
            "line-clamp-2 text-sm",
            dot.lastRun?.error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {said ?? dot.instructions}
        </p>
        <p className="mt-auto text-muted-foreground text-xs">
          {dot.enabled ? null : <Trans>Paused</Trans>}
          {dot.enabled && dot.status === "running" ? (
            <Trans>Working on it…</Trans>
          ) : null}
          {dot.enabled && dot.status !== "running" && next ? (
            <Trans>Next check-in {next}</Trans>
          ) : null}
          {dot.unread ? (
            <span className="ms-2 font-medium text-foreground">
              <Trans>New</Trans>
            </span>
          ) : null}
        </p>
      </a>
    </li>
  );
}

export function DotsScreen() {
  const router = useRouter();
  const { query } = useApi();
  const dots = useQuery({
    ...query.dots.list.queryOptions({ input: {} }),
    refetchInterval: DOTS_REFRESH_MS,
  });
  const [making, setMaking] = useState(false);
  const created = useCallback(
    (dot: Dot) => router.push(routes.chat(dot.conversationId)),
    [router]
  );
  const make = useCallback(() => setMaking(true), []);
  const cancel = useCallback(() => setMaking(false), []);

  return (
    <QueryState query={dots}>
      {(list) =>
        list.length === 0 || making ? (
          <div className="flex flex-col gap-2">
            {making ? (
              <Button className="self-start" onClick={cancel} variant="ghost">
                <ArrowLeftIcon
                  className="rtl:-scale-x-100"
                  data-icon="inline-start"
                />
                <Trans>Your Dots</Trans>
              </Button>
            ) : null}
            <DotOnboarding existing={list.length} onCreated={created} />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h1 className="font-semibold text-2xl">
                  <Trans>Your Dots</Trans>
                </h1>
                <p className="text-muted-foreground text-sm">
                  <Trans>
                    Always-on agents you can talk to. They keep working while
                    you're away and tell you what they did.
                  </Trans>
                </p>
              </div>
              <Button onClick={make}>
                <PlusIcon data-icon="inline-start" />
                <Trans>New Dot</Trans>
              </Button>
            </header>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {list.map((dot) => (
                <DotCard dot={dot} key={dot.id} />
              ))}
            </ul>
          </div>
        )
      }
    </QueryState>
  );
}

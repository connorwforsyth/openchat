"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import { MonitorIcon, PlayIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";

import { unseenRuns } from "./activity";
import { DotAvatar } from "./dot-avatar";
import { type DotExtensions, dotExtensions } from "./dot-extensions";
import { DotProfile, type DotProfileTab, RunStatusBadge } from "./dot-profile";
import { useNextRunText } from "./schedule-text";

// A Dot's home is its conversation (172): this is the bar above it (who
// you're talking to, what it's doing, Call and Profile) and, when it did
// things while you were away, a short "since you last looked" at the top.
// Opening the chat marks its runs read. Nothing renders for an ordinary chat.

/** How often a Dot's state refreshes while its chat is open. */
export const DOTS_REFRESH_MS = 10_000;

/** The Dot whose chat this is, if any. */
export const useDotForConversation = (
  conversationId: ConversationId | null
): Dot | undefined => {
  const { query } = useApi();
  const dots = useQuery({
    ...query.dots.list.queryOptions({ input: {} }),
    enabled: conversationId !== null,
    refetchInterval: DOTS_REFRESH_MS,
  });
  return dots.data?.find((each) => each.conversationId === conversationId);
};

function SinceYouLooked({
  dot,
  onDismiss,
  since,
}: {
  readonly dot: Dot;
  readonly onDismiss: () => void;
  readonly since: string | null;
}) {
  const { t } = useLingui();
  const { query } = useApi();
  const activity = useQuery(
    query.dots.activity.queryOptions({ input: { id: dot.id, limit: 10 } })
  );
  const items = unseenRuns(activity.data ?? [], since);
  if (items.length === 0) {
    return null;
  }
  const count = items.length;
  const { name } = dot;
  return (
    <section
      aria-label={t`What ${name} did since you last looked`}
      className="mx-auto mt-3 flex w-full max-w-3xl gap-3 rounded-xl border border-border bg-card p-3 text-sm"
    >
      <DotAvatar avatar={dot.avatar} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-medium">
          <Plural
            one="While you were away, I ran # task."
            other="While you were away, I ran # tasks."
            value={count}
          />
        </p>
        <ul className="flex flex-col gap-1.5">
          {items.slice(0, 3).map((item) => (
            <li className="flex min-w-0 items-start gap-2" key={item.runId}>
              <RunStatusBadge status={item.status} />
              <span className="line-clamp-2 min-w-0 text-muted-foreground">
                {item.error ?? item.snippet ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Button
        aria-label={t`Dismiss`}
        onClick={onDismiss}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </section>
  );
}

export interface DotHomeProps {
  readonly conversationId: ConversationId | null;
  /** Plug-ins (Call, Computer); defaults to `dotExtensions`. */
  readonly extensions?: Partial<DotExtensions>;
  /** Shows "Computer", which opens the side panel's live view. */
  readonly onOpenComputer?: () => void;
}

export function DotHome({
  conversationId,
  extensions,
  onOpenComputer,
}: DotHomeProps) {
  const { t } = useLingui();
  const { client, query } = useApi();
  const queryClient = useQueryClient();
  const nextText = useNextRunText();
  const dot = useDotForConversation(conversationId);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tab, setTab] = useState<DotProfileTab>("activity");
  const { CallButton } = { ...dotExtensions, ...extensions };
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.dots.key() }),
    [query, queryClient]
  );
  const runNow = useMutation({
    mutationFn: () =>
      dot ? client.dots.runNow({ id: dot.id }) : Promise.reject(),
    onSettled: refresh,
  });

  // "Since you last looked" is from before this visit: keep the first
  // `lastViewedAt` seen, then mark the Dot read.
  const since = useRef<{ readonly at: string | null } | null>(null);
  const [greeting, setGreeting] = useState(false);
  const dotId = dot?.id;
  const unread = dot?.unread ?? false;
  if (dot && since.current === null) {
    since.current = { at: dot.lastViewedAt };
  }
  useEffect(() => {
    if (dotId && unread) {
      setGreeting(true);
      client.dots
        .markRead({ id: dotId })
        .then(refresh)
        .catch(() => undefined);
    }
  }, [client, dotId, refresh, unread]);
  const dismiss = useCallback(() => setGreeting(false), []);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const { mutate: runMutate } = runNow;
  const run = useCallback(() => runMutate(), [runMutate]);

  if (!dot) {
    return null;
  }
  const { name } = dot;
  const next = dot.enabled ? nextText(dot.nextRunAt) : null;
  let status: React.ReactNode = <Trans>Here to help</Trans>;
  if (!dot.enabled) {
    status = <Trans>Paused</Trans>;
  } else if (dot.status === "running") {
    status = <Trans>Working on it…</Trans>;
  } else if (next) {
    status = <Trans>Next check-in {next}</Trans>;
  }
  return (
    <>
      <div className="flex shrink-0 justify-center border-border border-b px-4 py-2">
        <section
          aria-label={t`${name}, your Dot`}
          className="flex w-full max-w-3xl items-center gap-3"
        >
          <button
            aria-label={t`Open ${name}'s profile`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={openProfile}
            type="button"
          >
            <DotAvatar avatar={dot.avatar} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-sm">
                {dot.name}{" "}
                <span className="font-normal text-muted-foreground">
                  @{dot.handle}
                </span>
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {status}
              </span>
            </span>
          </button>
          {CallButton ? <CallButton dot={dot} /> : null}
          {onOpenComputer ? (
            <Button
              aria-label={t`Open ${name}'s computer`}
              onClick={onOpenComputer}
              size="icon-sm"
              title={t`Computer`}
              variant="ghost"
            >
              <MonitorIcon />
            </Button>
          ) : null}
          <Button
            aria-label={t`Run ${name} now`}
            disabled={runNow.isPending || dot.status === "running"}
            onClick={run}
            size="icon-sm"
            title={t`Check in now`}
            variant="ghost"
          >
            <PlayIcon />
          </Button>
          <Button onClick={openProfile} size="sm" variant="outline">
            <Trans>Profile</Trans>
          </Button>
        </section>
      </div>
      {greeting && since.current ? (
        <div className="shrink-0 px-4">
          <SinceYouLooked
            dot={dot}
            onDismiss={dismiss}
            since={since.current.at}
          />
        </div>
      ) : null}
      <DotProfile
        dot={dot}
        extensions={extensions}
        onOpenChange={setProfileOpen}
        onTabChange={setTab}
        open={profileOpen}
        tab={tab}
      />
    </>
  );
}

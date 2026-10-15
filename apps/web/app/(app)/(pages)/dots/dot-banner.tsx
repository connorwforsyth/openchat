"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { BotIcon, PlayIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { routes } from "@/lib/routes";

import { DOTS_REFRESH_MS } from "./dots-screen";
import { useNextRunText, useSchedulesSummary } from "./schedule-text";

// The schedule header on a Dot's own chat (172): which Dot this is, when it
// runs next, and "Run now". Viewing the chat marks the Dot's results read.
// Nothing renders for an ordinary chat.

export function DotBanner({
  conversationId,
}: {
  readonly conversationId: ConversationId | null;
}) {
  const { t } = useLingui();
  const { client, query } = useApi();
  const queryClient = useQueryClient();
  const summary = useSchedulesSummary();
  const nextText = useNextRunText();
  const dots = useQuery({
    ...query.dots.list.queryOptions({ input: {} }),
    enabled: conversationId !== null,
    refetchInterval: DOTS_REFRESH_MS,
  });
  const dot = dots.data?.find((each) => each.conversationId === conversationId);
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.dots.key() }),
    [query, queryClient]
  );
  const runNow = useMutation({
    mutationFn: () =>
      dot ? client.dots.runNow({ id: dot.id }) : Promise.reject(),
    onSettled: refresh,
  });
  const dotId = dot?.id;
  const unread = dot?.unread ?? false;
  useEffect(() => {
    if (dotId && unread) {
      client.dots
        .markRead({ id: dotId })
        .then(refresh)
        .catch(() => undefined);
    }
  }, [client, dotId, refresh, unread]);
  const { mutate } = runNow;
  const start = useCallback(() => mutate(), [mutate]);
  const router = useRouter();
  const manage = useCallback(() => router.push(routes.dots), [router]);

  if (!dot) {
    return null;
  }
  const next = dot.enabled ? nextText(dot.nextRunAt) : null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-20 flex justify-center px-4">
      <section
        aria-label={t`Dot schedule`}
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-background/95 py-1 ps-3 pe-1 text-sm shadow-sm backdrop-blur"
      >
        <BotIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="truncate font-medium">{dot.name}</span>
        <span className="hidden truncate text-muted-foreground sm:inline">
          {summary(dot)}
          {next ? (
            <>
              {" · "}
              <Trans>next {next}</Trans>
            </>
          ) : null}
        </span>
        <Button
          disabled={runNow.isPending || dot.status === "running"}
          onClick={start}
          size="xs"
          variant="outline"
        >
          <PlayIcon data-icon="inline-start" />
          <Trans>Run now</Trans>
        </Button>
        <Button onClick={manage} size="xs" variant="ghost">
          <Trans>Manage</Trans>
        </Button>
      </section>
    </div>
  );
}

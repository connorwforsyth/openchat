"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import { KeyboardIcon, MonitorIcon, RotateCcwIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback } from "react";
import { z } from "zod";
import type { DotSurfaceProps } from "./dot-extensions";
import { DOTS_REFRESH_MS, useDotForConversation } from "./dot-home";

// A Dot's own computer, live (172): pinned above the Workspace panel in the
// Dot's chat (the bar's "Computer" button opens it) and the body of the
// profile's Computer tab. The screen is noVNC on the sandbox preview origin
// (D24), in an iframe without same-origin rights. Watching is view-only;
// "Take over" hands the person the mouse and keyboard and makes the Dot's
// `computer` tool refuse input until "Give back control". Nothing renders
// for an ordinary chat.

const viewSchema = z.object({
  holder: z.enum(["user", "agent"]),
  url: z.url(),
});
type ComputerView = z.infer<typeof viewSchema>;

const computerPath = (conversationId: string) =>
  `/api/computer/${conversationId}`;

const readView = async (response: Response): Promise<ComputerView> => {
  if (!response.ok) {
    throw new Error(String(response.status));
  }
  return viewSchema.parse(await response.json());
};

/** The view's URL with input on or off. */
const screenUrl = (view: ComputerView) => {
  const url = new URL(view.url);
  url.searchParams.set("view_only", view.holder === "user" ? "0" : "1");
  return url.toString();
};

const viewKey = (conversationId: ConversationId) =>
  ["dot-computer", conversationId] as const;

/** In the Dot's chat: the panel's live view; nothing for other chats. */
export function DotComputer({
  conversationId,
}: {
  readonly conversationId: ConversationId | null;
}) {
  const dot = useDotForConversation(conversationId);
  return dot ? <DotComputerView dot={dot} /> : null;
}

/**
 * The profile tab's label: "Computer", with a live dot while the Dot is at
 * work on it. It reads the view only if something already opened it, so a
 * label never starts a desktop.
 */
export function DotComputerLabel({ dot }: DotSurfaceProps) {
  const { t } = useLingui();
  const view = useQuery<ComputerView>({
    enabled: false,
    queryKey: viewKey(dot.conversationId),
  });
  const live = view.data?.holder === "agent" && dot.status === "running";
  return (
    <>
      <Trans>Computer</Trans>
      {live ? (
        <span
          aria-label={t`${dot.name} is using it`}
          className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
          role="img"
        />
      ) : null}
    </>
  );
}

export function DotComputerView({ dot }: { readonly dot: Dot }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { conversationId } = dot;
  const key = viewKey(conversationId);
  const view = useQuery({
    queryFn: () =>
      fetch(computerPath(conversationId), { cache: "no-store" }).then(readView),
    queryKey: key,
    refetchInterval: DOTS_REFRESH_MS,
    retry: 1,
  });
  const control = useMutation({
    mutationFn: (next: ComputerView["holder"]) =>
      fetch(`${computerPath(conversationId)}/control`, {
        body: JSON.stringify({ holder: next }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }).then(readView),
    onSuccess: (next) => queryClient.setQueryData(key, next),
  });

  const { refetch } = view;
  const retry = useCallback(() => refetch(), [refetch]);
  const { mutate } = control;
  const holder = view.data?.holder;
  const toggle = useCallback(
    () => mutate(holder === "user" ? "agent" : "user"),
    [holder, mutate]
  );

  const current = view.data;
  const userHas = holder === "user";
  const status = (): string => {
    if (current) {
      return userHas ? t`You have control` : t`${dot.name} has control`;
    }
    return view.isError ? t`Not available right now` : t`Starting…`;
  };
  return (
    <section
      aria-label={t`${dot.name}'s computer`}
      className="flex shrink-0 flex-col border-border border-b bg-background"
      data-slot="dot-computer"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        <MonitorIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="font-medium">
          <Trans>Computer</Trans>
        </span>
        <span
          aria-live="polite"
          className="min-w-0 flex-1 truncate text-muted-foreground"
        >
          {status()}
        </span>
        {view.isError ? (
          <Button onClick={retry} size="sm" variant="ghost">
            <RotateCcwIcon aria-hidden />
            <Trans>Retry</Trans>
          </Button>
        ) : null}
        {current ? (
          <Button
            disabled={control.isPending}
            onClick={toggle}
            size="sm"
            variant={userHas ? "default" : "outline"}
          >
            <KeyboardIcon aria-hidden />
            {userHas ? (
              <Trans>Give back control</Trans>
            ) : (
              <Trans>Take over</Trans>
            )}
          </Button>
        ) : null}
      </div>
      <div className="relative aspect-[16/10] w-full bg-muted">
        {current ? (
          <iframe
            allow="clipboard-read; clipboard-write"
            className="absolute inset-0 size-full border-0"
            // A new src when control changes: noVNC reconnects with input on or off.
            key={current.holder}
            sandbox="allow-scripts"
            src={screenUrl(current)}
            title={t`${dot.name}'s screen`}
          />
        ) : null}
      </div>
    </section>
  );
}

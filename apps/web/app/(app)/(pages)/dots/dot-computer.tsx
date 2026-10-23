"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RunnerUnavailableNotice } from "@workspace/chat-ui/workspace/runner-unavailable";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Dot } from "@workspace/contract/schemas/dots";
import {
  EllipsisIcon,
  KeyboardIcon,
  MonitorIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "@workspace/icons";
import {
  type RunnerUnavailableReason,
  runnerUnavailableReasonSchema,
} from "@workspace/sandbox/runner/unavailable";
import {
  type ComputerPowerAction,
  type ComputerView,
  computerViewSchema,
} from "@workspace/server/dots/computer-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useToastManager } from "@workspace/ui/components/toast";
import { useCallback, useState } from "react";
import { z } from "zod";
import { codeOf } from "@/app/(app)/_shared/query-state";
import type { DotSurfaceProps } from "./dot-extensions";
import { DOTS_REFRESH_MS, useDotForConversation } from "./dot-home";
import { useScreenLink } from "./screen-link";

// A Dot's own computer, live (172): pinned above the Workspace panel in the
// Dot's chat (the bar's "Computer" button opens it) and the body of the
// profile's Computer tab. The screen is noVNC on the sandbox preview origin
// (D24), in an iframe without same-origin rights. Watching is view-only;
// "Take over" hands the person the mouse and keyboard and makes the Dot's
// `computer` tool refuse input until "Give back control". Restart and reset
// stop its runs before restoring the screen. Runner failures include the
// reason and recovery command. Nothing renders for an ordinary chat.

const computerPath = (conversationId: string) =>
  `/api/computer/${conversationId}`;

const problemSchema = z.object({
  code: z.string(),
  reason: runnerUnavailableReasonSchema.optional().catch(undefined),
});

/** The view, or a failure carrying the server's `code` (for `codeOf`) and the runner's `reason`. */
const readView = async (response: Response): Promise<ComputerView> => {
  if (!response.ok) {
    const body = problemSchema.safeParse(
      await response.json().catch(() => null)
    );
    throw Object.assign(new Error(String(response.status)), {
      code: body.success ? body.data.code : null,
      reason: body.success ? (body.data.reason ?? null) : null,
    });
  }
  return computerViewSchema.parse(await response.json());
};

const reasonOf = (error: unknown): RunnerUnavailableReason | null =>
  error instanceof Error && "reason" in error
    ? (runnerUnavailableReasonSchema.safeParse(error.reason).data ?? null)
    : null;

const viewKey = (conversationId: ConversationId) =>
  ["dot-computer", conversationId] as const;

/**
 * Restart and reset share one mutation key, so the view and every menu see
 * a power action in flight, and the screen reloads after one lands.
 */
const powerKey = (conversationId: ConversationId) =>
  ["dot-computer-power", conversationId] as const;

/** The power action in flight, if any, and when the last one finished. */
const usePowerState = (conversationId: ConversationId) => {
  const mutationKey = powerKey(conversationId);
  const pending = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables as ComputerPowerAction,
  });
  const landed = useMutationState({
    filters: { mutationKey, status: "success" },
    select: (mutation) => mutation.state.submittedAt,
  });
  return { landed: Math.max(0, ...landed), pending: pending.at(-1) };
};

/**
 * Restart (keep files) and "Reset computer" (wipe, after a confirm) for a
 * Dot's computer. `onShow` brings the live view on screen as it starts.
 */
export function DotComputerActions({
  dot,
  onShow,
}: DotSurfaceProps & { readonly onShow?: () => void }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { add } = useToastManager();
  const [confirming, setConfirming] = useState(false);
  const { conversationId, name } = dot;
  const busy = useIsMutating({ mutationKey: powerKey(conversationId) }) > 0;
  const power = useMutation({
    // Kept, so the view's screen remembers which power action it reloaded for.
    gcTime: Number.POSITIVE_INFINITY,
    mutationFn: (action: ComputerPowerAction) =>
      fetch(`${computerPath(conversationId)}/${action}`, {
        method: "POST",
      }).then(readView),
    mutationKey: powerKey(conversationId),
    onError: (error, action) =>
      add({
        description:
          codeOf(error) === "FEATURE_DISABLED"
            ? t`Computers aren't set up on this server.`
            : t`The computer isn't available right now. Check that the sandbox runner is running.`,
        title:
          action === "restart"
            ? t`Couldn't restart ${name}'s computer`
            : t`Couldn't reset ${name}'s computer`,
        type: "error",
      }),
    onMutate: () => onShow?.(),
    onSuccess: (view) =>
      queryClient.setQueryData(viewKey(conversationId), view),
  });
  const { mutate } = power;
  const restart = useCallback(() => mutate("restart"), [mutate]);
  const askReset = useCallback(() => setConfirming(true), []);
  const reset = useCallback(() => {
    setConfirming(false);
    mutate("reset");
  }, [mutate]);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`${name}'s computer options`}
              size="icon-sm"
              title={t`Computer options`}
              variant="ghost"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={busy} onClick={restart}>
            <RefreshCwIcon aria-hidden />
            <Trans>Restart computer</Trans>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            onClick={askReset}
            variant="destructive"
          >
            <RotateCcwIcon aria-hidden />
            <Trans>Reset computer…</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Reset {name}'s computer?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                This stops what {name} is doing and erases everything on its
                computer: files, downloads and browser data. It starts again
                empty. This can't be undone.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={reset} variant="destructive">
              <Trans>Reset computer</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

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
  const power = usePowerState(conversationId);
  const view = useQuery({
    // The computer is going away and coming back; the action's answer is the view.
    enabled: power.pending === undefined,
    queryFn: () =>
      fetch(computerPath(conversationId), { cache: "no-store" }).then(readView),
    queryKey: key,
    // A server without computers won't grow them by asking again.
    refetchInterval: (query) =>
      codeOf(query.state.error) === "FEATURE_DISABLED"
        ? false
        : DOTS_REFRESH_MS,
    retry: (failures, error) =>
      failures < 1 && codeOf(error) !== "FEATURE_DISABLED",
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

  const screen = useScreenLink();

  const current = power.pending ? undefined : view.data;
  const disabled = codeOf(view.error) === "FEATURE_DISABLED";
  const reason = current ? null : reasonOf(view.error);
  const userHas = holder === "user";
  const status = (): string => {
    if (power.pending === "restart") {
      return t`Restarting…`;
    }
    if (power.pending === "reset") {
      return t`Resetting…`;
    }
    if (current && screen.failed) {
      return t`Screen disconnected`;
    }
    if (current) {
      return userHas ? t`You have control` : t`${dot.name} has control`;
    }
    if (disabled) {
      return t`Computers aren't set up on this server`;
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
        {!power.pending && ((view.isError && !disabled) || screen.failed) ? (
          <Button
            onClick={screen.failed ? screen.reconnect : retry}
            size="sm"
            variant="ghost"
          >
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
        {disabled ? null : <DotComputerActions dot={dot} />}
      </div>
      {reason ? (
        <RunnerUnavailableNotice
          className="border-border border-t px-3 py-2 text-sm"
          reason={reason}
        />
      ) : null}
      <div className="relative aspect-[16/10] w-full bg-muted">
        {current ? (
          <iframe
            allow="clipboard-read; clipboard-write"
            className="absolute inset-0 size-full border-0"
            // The desktop ignores input until the person takes over; until
            // then the frame shouldn't take focus or keystrokes either.
            inert={!userHas}
            key={`${power.landed}-${screen.attempt}`}
            ref={screen.ref}
            sandbox="allow-scripts"
            src={current.url}
            title={t`${dot.name}'s screen`}
          />
        ) : null}
      </div>
    </section>
  );
}

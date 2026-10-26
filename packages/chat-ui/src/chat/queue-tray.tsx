"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { RunId } from "@workspace/contract/schemas/common";
import {
  ClockIcon,
  CornerDownLeftIcon,
  PencilIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { type ComponentProps, type ReactNode, useCallback } from "react";

import type { QueuedTurn } from "../model/queue";

// The turns waiting on the answer being written, over the composer (as
// Claude Code, Codex and T3 Code show theirs): each can steer the answer
// now, go back into the composer to edit, or go.

export interface QueueActions {
  /** Back into the composer, out of the queue. */
  readonly onEdit: (turn: QueuedTurn) => void;
  readonly onRemove: (turn: QueuedTurn) => void;
  /** Into the answer being written, at its next step. */
  readonly onSteer: (turn: QueuedTurn) => void;
}

function Action({
  children,
  label,
  ...props
}: ComponentProps<typeof Button> & {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            size="icon-xs"
            type="button"
            variant="ghost"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function QueuedRow({
  actions,
  busy,
  turn,
}: {
  readonly actions: QueueActions;
  /** An action on it is on its way. */
  readonly busy: boolean;
  readonly turn: QueuedTurn;
}) {
  const { t } = useLingui();
  const steer = useCallback(() => actions.onSteer(turn), [actions, turn]);
  const edit = useCallback(() => actions.onEdit(turn), [actions, turn]);
  const remove = useCallback(() => actions.onRemove(turn), [actions, turn]);
  const steering = turn.delivery === "steer";
  // Only the turn next in line can join the answer being written; a steer
  // behind another turn joins the answer to that one.
  const steersNow = steering && turn.position === 1;
  const text = turn.text ?? "";
  return (
    <li
      className="flex min-h-8 items-center gap-2 ps-3 pe-1 text-sm"
      data-delivery={turn.delivery}
    >
      {steering ? (
        <CornerDownLeftIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : (
        <ClockIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="shrink-0 text-muted-foreground text-xs">
        {steersNow ? (
          <span className="motion-safe:animate-pulse">
            <Trans>Steering at the next step…</Trans>
          </span>
        ) : null}
        {steering && !steersNow ? (
          <Trans>Steers the answer before it</Trans>
        ) : null}
        {steering ? null : <Trans>Queued</Trans>}
      </span>
      <span className="flex shrink-0 items-center">
        {steering ? null : (
          <Action disabled={busy} label={t`Steer now`} onClick={steer}>
            <CornerDownLeftIcon aria-hidden />
          </Action>
        )}
        <Action
          disabled={busy || turn.text === null}
          label={t`Edit`}
          onClick={edit}
        >
          <PencilIcon aria-hidden />
        </Action>
        <Action
          disabled={busy}
          label={t`Remove from the queue`}
          onClick={remove}
        >
          <XIcon aria-hidden />
        </Action>
      </span>
    </li>
  );
}

/** The queue over the composer; nothing while it's empty. */
export function QueueTray({
  actions,
  pending,
  turns,
}: {
  readonly actions: QueueActions;
  /** Turns an action is on its way for. */
  readonly pending: ReadonlySet<RunId>;
  readonly turns: readonly QueuedTurn[];
}) {
  const { t } = useLingui();
  if (turns.length === 0) {
    return null;
  }
  return (
    <section
      aria-label={t`Queued messages`}
      className="mx-auto w-full max-w-3xl px-4"
      data-testid="queue-tray"
    >
      <ol className="divide-y divide-border rounded-lg border border-border bg-muted/40">
        {turns.map((turn) => (
          <QueuedRow
            actions={actions}
            busy={pending.has(turn.runId)}
            key={turn.runId}
            turn={turn}
          />
        ))}
      </ol>
    </section>
  );
}

"use client";

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import type { Artifact } from "@workspace/contract/schemas/files";
import {
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  CornerDownLeftIcon,
  type Icon,
  MinusIcon,
  ShapesIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
} from "react";

import { kindIcon } from "../artifacts/kind-icon";
import { toolIcons } from "../conversation/tool-status";
import { toolSummary } from "../model/tool-summary";
import {
  type ArtifactInMaking,
  artifactsInMaking,
  type ChatTask,
  type TaskStatus,
} from "./chat-tasks";

// The outputs card (night 2, decision 4, after ChatGPT's Outputs card): the
// chat's artifacts and what the agent is working on, floating over the chat
// column's top end. The header's button collapses it and opens it again.

/** How wide the chat column must be for the card to stay open beside it. */
export const ROOMY_COLUMN_PX = 480;

/** How a toggle was made: keyboard toggles don't animate (D28). */
export type ToggleVia = "keyboard" | "pointer";

/** The chat's artifacts, the one changed last first. Pure. */
export const artifactsByChange = (
  artifacts: readonly Artifact[]
): readonly Artifact[] =>
  [...artifacts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const viaOf = (event: MouseEvent): ToggleVia =>
  // A click a key made (Enter, Space) has no pointer behind it.
  event.detail === 0 ? "keyboard" : "pointer";

export function OutputsButton({
  busy,
  controls,
  count,
  hint,
  onToggle,
  ref,
  shown,
}: {
  /** An answer is being written or waits; shown while the card isn't. */
  readonly busy: boolean;
  readonly controls: string;
  readonly count: number;
  readonly hint?: ReactNode;
  readonly onToggle: (via: ToggleVia) => void;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly shown: boolean;
}) {
  const { t } = useLingui();
  const click = useCallback(
    (event: MouseEvent) => onToggle(viaOf(event)),
    [onToggle]
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-controls={controls}
            aria-expanded={shown}
            aria-label={t`Artifacts and tasks`}
            className="relative gap-1 px-2 aria-expanded:bg-muted"
            data-outputs-toggle
            onClick={click}
            ref={ref}
            size="sm"
            variant="ghost"
          />
        }
      >
        <ShapesIcon aria-hidden />
        {count > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
        ) : null}
        {busy && !shown ? (
          <span
            aria-hidden
            className="absolute end-1 top-1 size-1.5 rounded-full bg-primary motion-safe:animate-status-pulse"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t`Artifacts and tasks`}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

const taskLooks: Readonly<
  Record<
    TaskStatus,
    { readonly icon: Icon | null; readonly label: MessageDescriptor }
  >
> = {
  queued: { icon: ClockIcon, label: msg`Queued` },
  running: { icon: null, label: msg`Working…` },
  steering: { icon: CornerDownLeftIcon, label: msg`Steering` },
  waiting: { icon: CircleAlertIcon, label: msg`Waiting for approval` },
};

export interface OutputsCardProps {
  readonly artifacts: readonly Artifact[];
  readonly cardRef: RefObject<HTMLElement | null>;
  /** The artifact the panel shows. */
  readonly current: ArtifactId | null;
  readonly id: string;
  /** Hide without the fade: it was a keyboard toggle (D28). */
  readonly instant: boolean;
  readonly onCollapse: (via: ToggleVia) => void;
  /** A click away from a card that only peeks; `undefined` while pinned. */
  readonly onDismiss?: () => void;
  readonly onPick: (artifact: Artifact) => void;
  /** The column got wider or narrower than `ROOMY_COLUMN_PX`. */
  readonly onRoomy: (roomy: boolean) => void;
  readonly onShowTask: (task: ChatTask) => void;
  readonly shown: boolean;
  readonly tasks: readonly ChatTask[];
}

/**
 * The card itself, inside the chat column (which it measures). It sits
 * clear of the composer and scrolls when it has more than fits.
 */
export function OutputsCard({
  artifacts,
  cardRef,
  current,
  id,
  instant,
  onCollapse,
  onDismiss,
  onPick,
  onRoomy,
  onShowTask,
  shown,
  tasks,
}: OutputsCardProps) {
  const { t } = useLingui();
  const rows = useMemo(() => artifactsByChange(artifacts), [artifacts]);
  const making = useMemo(() => artifactsInMaking(tasks), [tasks]);
  // This layer spans the chat column, so its width is the column's.
  const measure = useCallback(
    (column: HTMLDivElement) => {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          onRoomy(entry.contentRect.width >= ROOMY_COLUMN_PX);
        }
      });
      observer.observe(column);
      return () => observer.disconnect();
    },
    [onRoomy]
  );

  useEffect(() => {
    if (!(shown && onDismiss)) {
      return;
    }
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        !(
          cardRef.current?.contains(target) ||
          target?.closest("[data-outputs-toggle]")
        )
      ) {
        onDismiss();
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [cardRef, onDismiss, shown]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCollapse("keyboard");
      }
    },
    [onCollapse]
  );
  const collapse = useCallback(
    (event: MouseEvent) => onCollapse(viaOf(event)),
    [onCollapse]
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-3 pt-2"
      ref={measure}
    >
      <section
        aria-hidden={!shown}
        aria-label={t`Artifacts and tasks`}
        className={cn(
          "pointer-events-auto flex max-h-[min(32rem,calc(100cqh-12rem))] w-[min(18rem,45cqw)] flex-col gap-1 overflow-y-auto rounded-xl bg-popover p-1.5 text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10",
          // Appears at once; leaves with the one exit fade (D28).
          "data-[state=closed]:invisible data-[state=closed]:opacity-0",
          instant
            ? null
            : "data-[state=closed]:transition-[opacity,visibility] data-[state=closed]:duration-(--motion-exit) data-[state=closed]:ease-motion-out"
        )}
        data-state={shown ? "open" : "closed"}
        id={id}
        inert={!shown}
        onKeyDown={onKeyDown}
        ref={cardRef}
      >
        <div className="flex h-7 items-center justify-between ps-2">
          <h2 className="font-medium text-muted-foreground text-xs">
            <Trans>Artifacts</Trans>
          </h2>
          <Button
            aria-label={t`Collapse artifacts and tasks`}
            onClick={collapse}
            size="icon-xs"
            title={t`Collapse`}
            variant="ghost"
          >
            <MinusIcon aria-hidden />
          </Button>
        </div>
        {rows.length === 0 && making.length === 0 ? (
          <p className="px-2 pb-1.5 text-muted-foreground text-xs">
            <Trans>
              Nothing yet. Ask for a document, a deck, a site or a diagram and
              it appears here.
            </Trans>
          </p>
        ) : (
          <ul className="flex flex-col">
            {making.map((artifact) => (
              <li key={`making-${artifact.runId}-${artifact.title}`}>
                <MakingRow artifact={artifact} />
              </li>
            ))}
            {rows.map((artifact) => (
              <li key={artifact.id}>
                <ArtifactRow
                  artifact={artifact}
                  current={artifact.id === current}
                  onPick={onPick}
                />
              </li>
            ))}
          </ul>
        )}
        {tasks.length === 0 ? null : (
          <>
            <Separator className="mx-2 my-0.5 w-auto" />
            <h2 className="flex h-7 items-center ps-2 font-medium text-muted-foreground text-xs">
              <Trans>Tasks</Trans>
            </h2>
            <ul className="flex flex-col">
              {tasks.map((task) => (
                <li key={task.runId}>
                  <TaskRow onShow={onShowTask} task={task} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

const rowClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50";

function ArtifactRow({
  artifact,
  current,
  onPick,
}: {
  readonly artifact: Artifact;
  readonly current: boolean;
  readonly onPick: (artifact: Artifact) => void;
}) {
  const pick = useCallback(() => onPick(artifact), [artifact, onPick]);
  const Glyph = kindIcon(artifact.kind);
  return (
    <button
      aria-current={current || undefined}
      className={cn(rowClass, current && "bg-muted")}
      data-artifact-id={artifact.id}
      onClick={pick}
      type="button"
    >
      <Glyph aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
      {current ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
    </button>
  );
}

/** One the agent is creating: nothing to open until it's saved. */
function MakingRow({ artifact }: { readonly artifact: ArtifactInMaking }) {
  const Glyph = kindIcon(artifact.kind);
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground">
      <Glyph aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
      <span className="shrink-0 text-xs motion-safe:animate-status-pulse">
        <Trans>Making…</Trans>
      </span>
    </div>
  );
}

function TaskRow({
  onShow,
  task,
}: {
  readonly onShow: (task: ChatTask) => void;
  readonly task: ChatTask;
}) {
  const { i18n, t } = useLingui();
  const show = useCallback(() => onShow(task), [onShow, task]);
  const look = taskLooks[task.status];
  const step = task.step ? toolSummary(task.step, undefined) : null;
  const Glyph = step ? toolIcons[step.icon] : look.icon;
  return (
    <button
      className={cn(rowClass, "items-start")}
      data-status={task.status}
      onClick={show}
      type="button"
    >
      <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
        {Glyph ? (
          <Glyph aria-hidden className="size-3.5 text-muted-foreground" />
        ) : (
          <span
            aria-hidden
            className="size-2 rounded-full bg-primary motion-safe:animate-status-pulse"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{task.text || t`A message`}</span>
        <span className="truncate text-muted-foreground text-xs">
          {i18n._(step ? step.label : look.label)}
        </span>
      </span>
    </button>
  );
}

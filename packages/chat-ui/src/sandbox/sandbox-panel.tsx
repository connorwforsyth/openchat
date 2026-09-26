"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import {
  FileTextIcon,
  GlobeIcon,
  PlusIcon,
  RotateCcwIcon,
  ToolIcon,
  TriangleAlertIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

import { SandboxFiles } from "./files";
import type { SandboxPanelClient } from "./model/client";
import { SandboxPreview } from "./preview";
import { SandboxStatusPill } from "./status-pill";
import { SandboxTerminal } from "./terminal";
import { useSandboxPanel } from "./use-sandbox-panel";

// The chat's sandbox side panel (D7): status, a terminal, the file tree and
// a web preview. Load it through `LazySandboxPanel` (D27): it pulls in the
// code views, which nothing on the first screen needs.

type View = "terminal" | "files" | "preview";
const VIEWS: readonly View[] = ["terminal", "files", "preview"];

const ViewTab = ({
  baseId,
  icon,
  label,
  onSelect,
  selected,
  view,
}: {
  readonly baseId: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onSelect: (view: View) => void;
  readonly selected: boolean;
  readonly view: View;
}) => {
  const select = useCallback(() => onSelect(view), [onSelect, view]);
  return (
    <Button
      aria-controls={`${baseId}-panel-${view}`}
      aria-selected={selected}
      className={cn(
        selected ? "bg-muted text-foreground" : "text-muted-foreground"
      )}
      id={`${baseId}-tab-${view}`}
      onClick={select}
      role="tab"
      size="sm"
      tabIndex={selected ? 0 : -1}
      variant="ghost"
    >
      {icon}
      {label}
    </Button>
  );
};

export interface SandboxPanelProps {
  readonly className?: string;
  readonly client: SandboxPanelClient;
  /** The chat's sandbox when the panel opens, if it has one. */
  readonly initial: SandboxRecord | null;
  /** The runner's admin warning, e.g. no gVisor on this host. */
  readonly warning?: string | null;
}

export function SandboxPanel({
  className,
  client,
  initial,
  warning = null,
}: SandboxPanelProps) {
  const { t } = useLingui();
  const state = useSandboxPanel(client, initial);
  const [view, setView] = useState<View>("terminal");
  const baseId = useId();
  const { sandbox, refresh } = state;

  // The tree loads when the files view first opens, then after each command.
  useEffect(() => {
    if (view === "files") {
      refresh();
    }
  }, [view, refresh]);

  const labels: Readonly<Record<View, { icon: ReactNode; label: string }>> = {
    files: { icon: <FileTextIcon aria-hidden />, label: t`Files` },
    preview: { icon: <GlobeIcon aria-hidden />, label: t`Preview` },
    terminal: { icon: <ToolIcon aria-hidden />, label: t`Terminal` },
  };

  // Arrow keys move between tabs, as the ARIA tabs pattern expects.
  const onTabKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (step === undefined) {
        return;
      }
      event.preventDefault();
      const next =
        VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length] ??
        view;
      setView(next);
      document.getElementById(`${baseId}-tab-${next}`)?.focus();
    },
    [baseId, view]
  );

  const ready =
    sandbox?.status.state === "ready" || sandbox?.status.state === "stopped";

  return (
    <section
      aria-label={t`Sandbox`}
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="font-medium text-sm">
          <Trans>Sandbox</Trans>
        </h2>
        {sandbox ? <SandboxStatusPill sandbox={sandbox} /> : null}
        {sandbox ? (
          <Button
            aria-label={t`Reset sandbox`}
            className="ms-auto"
            disabled={state.busy || state.running}
            onClick={state.reset}
            size="icon-sm"
            title={t`Reset: start again with an empty workspace`}
            variant="ghost"
          >
            <RotateCcwIcon aria-hidden />
          </Button>
        ) : null}
      </header>

      {warning ? (
        <p className="flex items-start gap-2 border-b bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{warning}</span>
        </p>
      ) : null}
      {state.error ? (
        <p className="border-b px-3 py-2 text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {sandbox?.status.state === "failed" ? (
        <p className="border-b px-3 py-2 text-destructive text-sm" role="alert">
          {sandbox.status.message}
        </p>
      ) : null}

      {sandbox ? (
        <>
          <div
            aria-label={t`Sandbox views`}
            className="flex gap-1 border-b px-2 py-1"
            onKeyDown={onTabKey}
            role="tablist"
          >
            {VIEWS.map((option) => (
              <ViewTab
                baseId={baseId}
                icon={labels[option].icon}
                key={option}
                label={labels[option].label}
                onSelect={setView}
                selected={view === option}
                view={option}
              />
            ))}
          </div>
          <div
            aria-labelledby={`${baseId}-tab-${view}`}
            className="min-h-0 flex-1"
            id={`${baseId}-panel-${view}`}
            role="tabpanel"
          >
            {view === "terminal" ? (
              <SandboxTerminal
                disabled={!ready}
                log={state.log}
                onRun={state.run}
                running={state.running}
              />
            ) : null}
            {view === "files" ? (
              <SandboxFiles
                loading={state.listing}
                onRefresh={state.refresh}
                onSelect={state.select}
                open={state.open}
                paths={state.paths}
              />
            ) : null}
            {view === "preview" ? (
              <SandboxPreview
                error={state.previewError}
                onExpose={state.expose}
                preview={state.preview}
                supported={sandbox.provider !== "just-bash"}
              />
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="max-w-64 text-muted-foreground text-sm">
            <Trans>
              This chat has no sandbox yet. Create one to run commands and keep
              files the agent can work on.
            </Trans>
          </p>
          <Button disabled={state.busy} onClick={state.create} size="sm">
            <PlusIcon aria-hidden data-icon="inline-start" />
            <Trans>Create sandbox</Trans>
          </Button>
        </div>
      )}
    </section>
  );
}

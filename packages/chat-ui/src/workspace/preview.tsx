"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLinkIcon, GlobeIcon, RefreshCwIcon } from "@workspace/icons";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { useCallback, useEffect, useState } from "react";

import { probePreview } from "./model/preview-probe";

// The workspace's preview in the panel's main area. The URL is on the
// sandbox preview origin, never the app's (D24), and the iframe is
// sandboxed on top: no same-origin access, no top navigation, no app
// cookies. The agent records the port (its `preview` tool); there's no port
// box. Before showing the page, the panel checks something answers, so an
// app that isn't running yet gets a sentence instead of a proxy error.

export interface WorkspacePreviewProps {
  readonly preview: { readonly port: number; readonly url: string };
  /** Whether the URL answers; the default checks from an opaque-origin frame. */
  readonly probe?: (url: string) => Promise<boolean>;
}

type Check = "checking" | "answering" | "silent";

export function WorkspacePreview({
  preview,
  probe = probePreview,
}: WorkspacePreviewProps) {
  const { t } = useLingui();
  const [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<Check>("checking");
  const { port, url } = preview;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is Retry and Reload asking to check again.
  useEffect(() => {
    let current = true;
    setCheck("checking");
    probe(url).then(
      (answering) => {
        if (current) {
          setCheck(answering ? "answering" : "silent");
        }
      },
      () => {
        if (current) {
          setCheck("silent");
        }
      }
    );
    return () => {
      current = false;
    };
  }, [attempt, probe, url]);

  const again = useCallback(() => setAttempt((count) => count + 1), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        <GlobeIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 truncate font-mono text-xs" title={url}>
          {url}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <Button
            aria-label={t`Reload preview`}
            onClick={again}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCwIcon aria-hidden />
          </Button>
          <a
            aria-label={t`Open preview in a new tab`}
            className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon aria-hidden />
          </a>
        </div>
      </div>
      {check === "checking" ? (
        <div
          aria-busy
          className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm"
          role="status"
        >
          <Spinner />
          <Trans>Connecting to port {port}…</Trans>
        </div>
      ) : null}
      {check === "silent" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="max-w-72 text-muted-foreground text-sm">
            <Trans>
              Nothing is running on port {port} yet. Ask the agent to start the
              app.
            </Trans>
          </p>
          <Button onClick={again} size="sm" variant="outline">
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {check === "answering" ? (
        <iframe
          className="min-h-0 flex-1 bg-background"
          key={`${url}#${attempt}`}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          src={url}
          title={t`Preview of port ${port}`}
        />
      ) : null}
    </div>
  );
}

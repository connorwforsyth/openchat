"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLinkIcon, GlobeIcon, RefreshCwIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";

// A dev server's page inside the panel. The URL is on the sandbox preview
// origin, never the app's (D24), and the iframe is sandboxed on top: no
// same-origin access, no top navigation, no app cookies.

export interface SandboxPreviewProps {
  readonly error: string | null;
  readonly onExpose: (port: number) => void;
  readonly preview: { readonly port: number; readonly url: string } | null;
  /** False for providers with nothing to serve (just-bash). */
  readonly supported: boolean;
}

const MAX_PORT = 65_535;

export function SandboxPreview({
  error,
  onExpose,
  preview,
  supported,
}: SandboxPreviewProps) {
  const { t } = useLingui();
  const [port, setPort] = useState(preview ? String(preview.port) : "3000");
  const [reload, setReload] = useState(0);
  const parsed = Number(port);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PORT;
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (valid) {
        onExpose(parsed);
      }
    },
    [onExpose, parsed, valid]
  );
  const changePort = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPort(event.target.value),
    []
  );
  const reloadFrame = useCallback(() => setReload((count) => count + 1), []);

  if (!supported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm">
        <GlobeIcon aria-hidden className="size-5" />
        <p>
          <Trans>
            Previews need a Docker sandbox. This one is simulated, so nothing
            can listen on a port.
          </Trans>
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="flex items-center gap-2 border-b p-2" onSubmit={submit}>
        <Input
          aria-invalid={!valid}
          aria-label={t`Port`}
          className="h-8 w-24 font-mono text-xs"
          inputMode="numeric"
          onChange={changePort}
          value={port}
        />
        <Button disabled={!valid} size="sm" type="submit" variant="secondary">
          <Trans>Preview</Trans>
        </Button>
        {preview ? (
          <>
            <Button
              aria-label={t`Reload preview`}
              onClick={reloadFrame}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <RefreshCwIcon aria-hidden />
            </Button>
            <a
              aria-label={t`Open preview in a new tab`}
              className="ms-auto inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              href={preview.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              <span className="max-w-48 truncate">{preview.url}</span>
            </a>
          </>
        ) : null}
      </form>
      {error ? <p className="p-3 text-destructive text-sm">{error}</p> : null}
      {preview ? (
        <iframe
          className="min-h-0 flex-1 bg-background"
          key={`${preview.url}#${reload}`}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          src={preview.url}
          title={t`Preview of port ${preview.port}`}
        />
      ) : (
        <p className="p-4 text-muted-foreground text-sm">
          <Trans>
            Start a server in the terminal, then preview its port. It opens on a
            separate origin, isolated from this app.
          </Trans>
        </p>
      )}
    </div>
  );
}

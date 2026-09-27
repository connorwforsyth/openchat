"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { SendIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { TerminalEntry, TerminalLog } from "./model/log";

// A terminal-style log of commands and their output, plus a command line.
// It isn't a TTY (no curses, no stdin): commands run to completion, and
// output streams in as the provider sends it.

const Entry = ({ entry }: { readonly entry: TerminalEntry }) => {
  switch (entry.kind) {
    case "command":
      return (
        <div className="text-foreground">
          <span aria-hidden className="select-none text-muted-foreground">
            ${" "}
          </span>
          {entry.text}
        </div>
      );
    case "output":
      return (
        <div
          className={cn(
            "whitespace-pre-wrap break-all",
            entry.stream === "stderr" ? "text-destructive" : "text-foreground"
          )}
        >
          {entry.text}
        </div>
      );
    case "exit":
      return (
        <div className="pb-2 text-muted-foreground">
          {entry.timedOut ? (
            <Trans>Timed out after {entry.durationMs} ms</Trans>
          ) : (
            <Trans>
              Exited with code {entry.exitCode} in {entry.durationMs} ms
            </Trans>
          )}
          {entry.truncated ? (
            <>
              {" "}
              <Trans>(output shortened)</Trans>
            </>
          ) : null}
        </div>
      );
    case "error":
      return <div className="pb-2 text-destructive">{entry.message}</div>;
    default:
      return entry satisfies never;
  }
};

export interface SandboxTerminalProps {
  readonly disabled?: boolean;
  readonly log: TerminalLog;
  readonly onRun: (command: string) => void;
  readonly running: boolean;
}

export function SandboxTerminal({
  disabled = false,
  log,
  onRun,
  running,
}: SandboxTerminalProps) {
  const { t } = useLingui();
  const [command, setCommand] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const count = log.entries.length;

  // Follow new output, like a terminal does.
  useEffect(() => {
    if (count > 0) {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [count]);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = command.trim();
      if (!trimmed || running || disabled) {
        return;
      }
      onRun(trimmed);
      setCommand("");
    },
    [command, disabled, onRun, running]
  );
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setCommand(event.target.value),
    []
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        aria-label={t`Sandbox output`}
        className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3 font-mono text-xs leading-relaxed"
        role="log"
      >
        {count === 0 ? (
          <p className="text-muted-foreground">
            <Trans>Run a command to see its output here.</Trans>
          </p>
        ) : (
          log.entries.map((entry) => <Entry entry={entry} key={entry.id} />)
        )}
        <div ref={end} />
      </div>
      <form className="flex items-center gap-2 border-t p-2" onSubmit={submit}>
        <span
          aria-hidden
          className="ps-1 font-mono text-muted-foreground text-xs"
        >
          $
        </span>
        <Input
          aria-label={t`Command`}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="h-8 font-mono text-xs"
          disabled={disabled}
          onChange={change}
          placeholder={t`ls -la`}
          spellCheck={false}
          value={command}
        />
        <Button
          aria-label={running ? t`Running…` : t`Run command`}
          disabled={disabled || running || !command.trim()}
          size="icon"
          type="submit"
          variant="secondary"
        >
          <SendIcon aria-hidden />
        </Button>
      </form>
      <p aria-live="polite" className="sr-only">
        {running ? (
          <Trans>Command running</Trans>
        ) : (
          <Plural one="# log entry" other="# log entries" value={count} />
        )}
      </p>
    </div>
  );
}

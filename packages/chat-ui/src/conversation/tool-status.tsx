"use client";

import type { MessageDescriptor } from "@lingui/core";
import { Trans as TransRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CircleAlertIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  type Icon,
  ImageIcon,
  MonitorIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  ToolIcon,
  WrenchIcon,
} from "@workspace/icons";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
  CodeBlock,
  CodeBlockContent,
} from "@workspace/ui/components/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import { useCallback } from "react";

import type {
  ToolDetail,
  ToolIconName,
  ToolSummary,
} from "../model/tool-summary";

// One tool call as a quiet Trace line under the prose (shadcn's Tool
// pattern): an icon and what the agent did, muted, pulsing while it runs, or
// in the destructive colour when it failed. It expands to what's behind it: a
// command and the end of its output, or the raw input and result for anything
// else.

export const toolIcons: Readonly<Record<ToolIconName, Icon>> = {
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  MonitorIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  ToolIcon,
  WrenchIcon,
};

/** A summary label, with its `code` value (a command, a path) in code font. */
export function ToolLabel({ label }: { readonly label: MessageDescriptor }) {
  const code = label.values?.code;
  // Built outside the JSX so the extractor, which reads literal `values`,
  // leaves this runtime `Trans` alone: the ids come from `msg` descriptors.
  const values =
    typeof code === "string"
      ? {
          ...label.values,
          code: (
            <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
              {code}
            </code>
          ),
        }
      : label.values;
  return <TransRuntime id={label.id} message={label.message} values={values} />;
}

// A failure changes the icon's shape too, so it doesn't rest on colour alone.
function StatusIcon({ summary }: { readonly summary: ToolSummary }) {
  if (summary.status === "error") {
    return <CircleAlertIcon />;
  }
  const ToolGlyph = toolIcons[summary.icon];
  return <ToolGlyph />;
}

/** A tool's input or output as plain text in a small Code Block. */
function ToolCode({
  label,
  value,
  variant,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly variant?: "destructive";
}) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <section aria-label={label}>
      <CodeBlock size="sm" variant={variant}>
        <CodeBlockContent className="max-h-64" wrap>
          {text}
        </CodeBlockContent>
      </CodeBlock>
    </section>
  );
}

function Details({
  detail,
  errorText,
}: {
  readonly detail: ToolDetail;
  readonly errorText: string | undefined;
}) {
  const { t } = useLingui();
  switch (detail.kind) {
    case "bash": {
      const output = [detail.stdout, detail.stderr]
        .filter((text) => text.length > 0)
        .join("\n");
      return (
        <section aria-label={t`Command and output`}>
          <CodeBlock size="sm">
            <CodeBlockContent className="max-h-72" wrap>
              <span className="text-muted-foreground">$ </span>
              {detail.command}
              {output ? `\n${output}` : null}
            </CodeBlockContent>
          </CodeBlock>
        </section>
      );
    }
    case "raw":
      return (
        <div className="flex flex-col gap-3">
          <ToolCode label={t`Input`} value={detail.input} />
          {errorText ? (
            <ToolCode
              label={t`Error`}
              value={errorText}
              variant="destructive"
            />
          ) : null}
          {detail.output === undefined ? null : (
            <ToolCode label={t`Output`} value={detail.output} />
          )}
        </div>
      );
    // A finished change, skill or set of images renders as its card, never
    // as a line.
    case "file-change":
    case "image":
    case "skill":
      return null;
    default:
      return detail satisfies never;
  }
}

function PreviewButton({
  onOpen,
  url,
}: {
  readonly onOpen: (url: string) => void;
  readonly url: string;
}) {
  const open = useCallback(() => onOpen(url), [onOpen, url]);
  return (
    <Button onClick={open} size="xs" variant="ghost">
      <MonitorIcon aria-hidden data-icon="inline-start" />
      <Trans>Open</Trans>
    </Button>
  );
}

/** Who stopped a call's run, after what it was doing. */
function StoppedNote({ summary }: { readonly summary: ToolSummary }) {
  return (
    <TraceDescription className="text-xs" data-stopped-by={summary.stoppedBy}>
      {summary.stoppedBy === "user" ? (
        <Trans>Stopped by you</Trans>
      ) : (
        <Trans>Stopped</Trans>
      )}
    </TraceDescription>
  );
}

export function ToolStatus({
  onOpenPreview,
  stopped: ended = false,
  summary,
}: {
  /** Opens a preview in the app; without it, Open is a link to a new tab. */
  readonly onOpenPreview?: (url: string) => void;
  /**
   * A running call whose message has stopped streaming: the run ended
   * without its result, so it reads "Stopped" instead of spinning forever.
   */
  readonly stopped?: boolean;
  readonly summary: ToolSummary;
}) {
  const failed = summary.status === "error";
  const stopped = ended || summary.status === "stopped";
  let status: "running" | "error" | undefined;
  if (failed) {
    status = "error";
  } else if (summary.status === "running" && !stopped) {
    status = "running";
  }
  return (
    <Trace
      className="not-prose"
      data-status={stopped ? "stopped" : summary.status}
    >
      <TraceCollapsible>
        <div className="flex min-w-0 items-center gap-1">
          <TraceCollapsibleTrigger>
            <TraceLine status={status}>
              <TraceIcon>
                <StatusIcon summary={summary} />
              </TraceIcon>
              <TraceTitle>
                {ended ? (
                  <Trans>Stopped</Trans>
                ) : (
                  <ToolLabel label={summary.label} />
                )}
              </TraceTitle>
              {summary.status === "stopped" ? (
                <StoppedNote summary={summary} />
              ) : null}
              {failed && summary.errorText ? (
                <TraceDescription className="min-w-0 max-w-64 shrink truncate text-current text-xs opacity-80">
                  {summary.errorText}
                </TraceDescription>
              ) : null}
            </TraceLine>
          </TraceCollapsibleTrigger>
          {summary.previewUrl && onOpenPreview ? (
            <PreviewButton onOpen={onOpenPreview} url={summary.previewUrl} />
          ) : null}
          {summary.previewUrl && !onOpenPreview ? (
            <a
              className={buttonVariants({ size: "xs", variant: "ghost" })}
              href={summary.previewUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLinkIcon aria-hidden data-icon="inline-start" />
              <Trans>Open</Trans>
            </a>
          ) : null}
        </div>
        {/* Opens at once: D28 never animates height. */}
        <TraceCollapsibleContent>
          <Details detail={summary.detail} errorText={summary.errorText} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

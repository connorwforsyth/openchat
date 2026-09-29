"use client";

import type { MessageDescriptor } from "@lingui/core";
import { Trans as TransRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  type Icon,
  LoaderCircleIcon,
  MonitorIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  ToolIcon,
  WrenchIcon,
} from "@workspace/icons";
import {
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";
import { buttonVariants } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";

import type {
  ToolDetail,
  ToolIconName,
  ToolSummary,
} from "../model/tool-summary";

// One tool call as a quiet line under the prose (shadcn's chatbot template):
// an icon and what the agent did, muted, or in the destructive colour when
// it failed. It expands to what's behind it: a command and the end of its
// output, or the raw input and result for anything else.

export const toolIcons: Readonly<Record<ToolIconName, Icon>> = {
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  MonitorIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  ToolIcon,
  WrenchIcon,
};

/** A summary label, with its `code` value (a command, a path) in code font. */
export function ToolLabel({ label }: { readonly label: MessageDescriptor }) {
  const code = label.values?.code;
  return (
    <TransRuntime
      id={label.id}
      message={label.message}
      values={{
        ...label.values,
        ...(typeof code === "string"
          ? {
              code: (
                <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
                  {code}
                </code>
              ),
            }
          : {}),
      }}
    />
  );
}

function StatusIcon({ summary }: { readonly summary: ToolSummary }) {
  if (summary.status === "running") {
    // Spins (a transform) while the tool runs; with reduced motion it
    // breathes instead, which is opacity only (D28).
    return (
      <LoaderCircleIcon
        aria-hidden
        className="size-4 shrink-0 motion-safe:animate-spin motion-reduce:animate-pulse"
      />
    );
  }
  if (summary.status === "error") {
    return <CircleAlertIcon aria-hidden className="size-4 shrink-0" />;
  }
  const ToolGlyph = toolIcons[summary.icon];
  return <ToolGlyph aria-hidden className="size-4 shrink-0" />;
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
          <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
            <code>
              <span className="text-muted-foreground">$ </span>
              {detail.command}
              {output ? `\n${output}` : null}
            </code>
          </pre>
        </section>
      );
    }
    case "raw":
      return (
        <div className="flex flex-col gap-2">
          <ToolInput className="p-0" input={detail.input} />
          <ToolOutput
            className="p-0"
            errorText={errorText}
            output={detail.output}
          />
        </div>
      );
    // A finished change renders as its card, never as a line.
    case "file-change":
      return null;
    default:
      return detail satisfies never;
  }
}

export function ToolStatus({ summary }: { readonly summary: ToolSummary }) {
  const failed = summary.status === "error";
  return (
    <Collapsible
      className="not-prose flex flex-col gap-2"
      data-status={summary.status}
    >
      <div className="flex min-w-0 items-center gap-1">
        <CollapsibleTrigger
          className={cn(
            "group flex min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-start text-sm outline-none transition-colors duration-(--motion-fast) ease-motion-out focus-visible:ring-3 focus-visible:ring-ring/50",
            failed
              ? "text-destructive"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <StatusIcon summary={summary} />
          <span className="min-w-0 truncate">
            <ToolLabel label={summary.label} />
          </span>
          {failed && summary.errorText ? (
            <span className="min-w-0 max-w-64 truncate text-xs opacity-80">
              {summary.errorText}
            </span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-(--motion-fast) ease-motion-out group-hover:opacity-100 group-focus-visible:opacity-100 group-data-panel-open:rotate-180 group-data-panel-open:opacity-100"
          />
        </CollapsibleTrigger>
        {summary.previewUrl ? (
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
      <CollapsibleContent className="ps-7">
        <Details detail={summary.detail} errorText={summary.errorText} />
      </CollapsibleContent>
    </Collapsible>
  );
}

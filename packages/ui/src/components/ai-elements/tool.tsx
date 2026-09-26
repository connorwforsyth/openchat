"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  ClockIcon,
  ToolIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import type { ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export interface ToolHeaderProps {
  className?: string;
  state: ToolUIPart["state"];
  title?: string;
  type: ToolUIPart["type"];
}

type ToolState = ToolUIPart["state"];

// Status is carried by the label and icon shape; colour only reinforces it, so
// it stays on the semantic tokens the theme already defines.
const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-foreground" />,
  "approval-responded": (
    <CircleCheckIcon className="size-4 text-muted-foreground" />
  ),
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CircleCheckIcon className="size-4 text-primary" />,
  "output-denied": <CircleXIcon className="size-4 text-destructive" />,
  "output-error": <CircleXIcon className="size-4 text-destructive" />,
};

const ToolStatusBadge = ({ status }: { status: ToolState }) => {
  const { t } = useLingui();
  const labels: Record<ToolState, string> = {
    "approval-requested": t`Awaiting approval`,
    "approval-responded": t`Responded`,
    "input-available": t`Running`,
    "input-streaming": t`Pending`,
    "output-available": t`Completed`,
    "output-denied": t`Denied`,
    "output-error": t`Error`,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {statusIcons[status]}
      {labels[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "group flex w-full items-center justify-between gap-4 p-3",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <ToolIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">
        {/* Static tool parts are typed `tool-<name>`; show just the name. */}
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      <ToolStatusBadge status={state} />
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "h-(--collapsible-panel-height) overflow-hidden text-popover-foreground outline-none transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 data-ending-style:opacity-0 data-starting-style:opacity-0",
      className
    )}
    {...props}
  />
);

// Plain preformatted JSON for now: PLAN.md D16 puts every code surface on
// @pierre/diffs' CodeView (packages/code-ui), so AI Elements' Shiki code block
// isn't installed.
const ToolCode = ({ code }: { code: string }) => (
  <pre className="overflow-x-auto p-3 font-mono text-xs">
    <code>{code}</code>
  </pre>
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div
    className={cn("flex flex-col gap-2 overflow-hidden p-4", className)}
    {...props}
  >
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      <Trans>Parameters</Trans>
    </h4>
    <div className="rounded-md bg-muted/50">
      <ToolCode code={JSON.stringify(input, null, 2)} />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

const renderOutput = (output: ToolUIPart["output"]): ReactNode => {
  if (typeof output === "string") {
    return <ToolCode code={output} />;
  }
  if (typeof output === "object" && !isValidElement(output)) {
    return <ToolCode code={JSON.stringify(output, null, 2)} />;
  }
  return <div>{output as ReactNode}</div>;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? <Trans>Error</Trans> : <Trans>Result</Trans>}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText ? <div className="p-3">{errorText}</div> : null}
        {output ? renderOutput(output) : null}
      </div>
    </div>
  );
};

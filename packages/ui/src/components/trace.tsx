import { ChevronRightIcon } from "@workspace/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "cn";
import type * as React from "react";

function Trace({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 *:has-[>[data-slot=trace-line]]:flex *:has-[>[data-slot=trace-line]]:w-fit *:has-[>[data-slot=trace-line]]:min-w-0 *:has-[>[data-slot=trace-line]]:max-w-full *:has-[>[data-slot=trace-line]]:rounded-md *:has-[>[data-slot=trace-line]]:text-start *:has-[>[data-slot=trace-line]]:outline-none *:has-[>[data-slot=trace-line]]:focus-visible:ring-3 *:has-[>[data-slot=trace-line]]:focus-visible:ring-ring/50",
        className
      )}
      data-slot="trace"
      {...props}
    />
  );
}

// Padded to a 24px line (shadcn's is 20px, flush with the text), so a trigger
// around it is a comfortable hit target and bare lines line up with ones that
// expand. The content's rule moves in by the same amount, under the icon.
function TraceLine({
  className,
  status,
  ...props
}: React.ComponentProps<"span"> & {
  status?: "running" | "error" | "pending";
}) {
  return (
    <span
      className={cn(
        "flex w-fit min-w-0 max-w-full in-[a,button]:cursor-pointer items-center gap-2 px-1.5 py-0.5 in-[a:hover,button:hover]:text-foreground text-muted-foreground text-sm transition-colors data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=error]:text-destructive data-[status=pending]:opacity-60 data-[status=running]:*:data-[slot=trace-title]:motion-safe:animate-pulse",
        className
      )}
      data-slot="trace-line"
      data-status={status}
      {...props}
    />
  );
}

function TraceIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [[data-slot=trace-title]~&]:-ms-1",
        className
      )}
      data-slot="trace-icon"
      {...props}
    />
  );
}

function TraceTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("min-w-0 truncate", className)}
      data-slot="trace-title"
      {...props}
    />
  );
}

function TraceDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "shrink-0 text-muted-foreground/70 tabular-nums",
        className
      )}
      data-slot="trace-description"
      {...props}
    />
  );
}

function TraceCollapsible({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Collapsible>, "open"> &
  (
    | { open?: undefined }
    | {
        open: boolean;
        onOpenChange: NonNullable<
          React.ComponentProps<typeof Collapsible>["onOpenChange"]
        >;
      }
  )) {
  return (
    <Collapsible
      className={cn("flex w-full min-w-0 flex-col", className)}
      data-slot="trace-collapsible"
      {...props}
    />
  );
}

function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group/trace-collapsible-trigger flex w-fit min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md pe-1.5 text-start text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset has-[[data-status=error]]:text-destructive",
        className
      )}
      data-slot="trace-collapsible-trigger"
      {...props}
    >
      {children}
      <TraceIcon className="transition-transform duration-(--motion-fast) ease-motion-out group-aria-expanded/trace-collapsible-trigger:rotate-90">
        <ChevronRightIcon />
      </TraceIcon>
    </CollapsibleTrigger>
  );
}

function TraceCollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className="min-w-0 overflow-hidden"
      data-slot="trace-collapsible-content"
      {...props}
    >
      <div
        className={cn(
          "wrap-break-word ms-[calc(--spacing(3.5)-1px)] mt-2 mb-1 min-w-0 border-s ps-4 pe-1 text-muted-foreground leading-relaxed",
          className
        )}
        data-slot="trace-collapsible-content-inner"
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

export {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
};

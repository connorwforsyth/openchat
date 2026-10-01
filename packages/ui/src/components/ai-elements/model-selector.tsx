"use client";

// AI Elements' model selector (MIT, vercel/ai-elements
// `packages/elements/src/model-selector.tsx`), on our Base UI dialog and
// cmdk command, with a preview card beside the list (099, 105). See this
// folder's README for what changed from upstream.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { BrandMark, hasBrandMark } from "@workspace/icons/brands";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command";
import { DialogOverlay, DialogPortal } from "@workspace/ui/components/dialog";
import {
  PreviewPane,
  PreviewPaneContent,
  PreviewPaneList,
  usePreviewPane,
} from "@workspace/ui/components/preview-pane";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type ModelSelectorProps = DialogPrimitive.Root.Props;

export const ModelSelector = (props: ModelSelectorProps) => (
  <DialogPrimitive.Root data-slot="model-selector" {...props} />
);

export type ModelSelectorTriggerProps = DialogPrimitive.Trigger.Props;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <DialogPrimitive.Trigger data-slot="model-selector-trigger" {...props} />
);

type CommandProps = Omit<ComponentProps<typeof Command>, "children">;

function BoundCommand({
  children,
  command,
}: {
  readonly children: ReactNode;
  readonly command: CommandProps | undefined;
}) {
  const { bind } = usePreviewPane();
  return (
    <Command
      {...command}
      {...bind}
      className={cn(
        "**:data-[slot=command-input-wrapper]:h-auto",
        command?.className
      )}
    >
      {children}
    </Command>
  );
}

export type ModelSelectorContentProps = Omit<
  DialogPrimitive.Popup.Props,
  "children" | "title"
> & {
  readonly children: ReactNode;
  /**
   * Props for the inner cmdk root (`shouldFilter`, `loop`, …). Its
   * `value` / `onValueChange` are the highlighted row, which the preview
   * card follows.
   */
  readonly command?: CommandProps;
  /** The card for the highlighted row's value; `null` shows none. */
  readonly preview?: (value: string) => ReactNode;
  /** The dialog's accessible name. */
  readonly title: string;
};

/**
 * A modal overlay over a dimmed page (112). The list is centred on the
 * screen and the highlighted row's preview card hangs off its right edge,
 * or sits below it under 640px (105; 099 anchored it to the trigger). Its top edge
 * stays put, so the panel doesn't jump as a search shortens the list, and
 * sits near the top on a phone so the keyboard doesn't cover the search.
 * It appears at once and fades out (D28: the keyboard drives it). Focus
 * starts in the search field and goes back to the trigger when it closes.
 */
export const ModelSelectorContent = ({
  children,
  className,
  command,
  preview,
  title,
  ...props
}: ModelSelectorContentProps) => (
  <DialogPortal>
    <DialogOverlay className="bg-scrim" />
    <DialogPrimitive.Popup
      aria-label={title}
      className={cn(
        "data-closed:fade-out-0 fixed inset-x-0 top-[max(1rem,8vh)] z-50 mx-auto w-[min(28rem,calc(100vw-2rem))] outline-hidden duration-(--motion-exit) data-closed:animate-out sm:top-[18vh]",
        className
      )}
      data-slot="model-selector-content"
      {...props}
    >
      <PreviewPane
        className="relative"
        onValueChange={command?.onValueChange}
        value={command?.value}
      >
        <PreviewPaneList className="w-full flex-none overflow-hidden rounded-xl bg-popover shadow-lg ring-1 ring-foreground/10">
          <BoundCommand command={command}>{children}</BoundCommand>
        </PreviewPaneList>
        {preview ? (
          <PreviewPaneContent className="shadow-lg sm:absolute sm:top-0 sm:left-full sm:ml-2">
            {preview}
          </PreviewPaneContent>
        ) : null}
      </PreviewPane>
    </DialogPrimitive.Popup>
  </DialogPortal>
);

export type ModelSelectorInputProps = ComponentProps<typeof CommandInput>;

export const ModelSelectorInput = ({
  className,
  ...props
}: ModelSelectorInputProps) => (
  <CommandInput className={cn("h-auto py-2", className)} {...props} />
);

export type ModelSelectorListProps = ComponentProps<typeof CommandList>;

export const ModelSelectorList = ({
  className,
  ...props
}: ModelSelectorListProps) => (
  <CommandList
    className={cn(
      "max-h-[min(22rem,40vh)] sm:max-h-[min(24rem,50vh)]",
      className
    )}
    {...props}
  />
);

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>;

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
  <CommandEmpty {...props} />
);

export type ModelSelectorGroupProps = ComponentProps<typeof CommandGroup>;

export const ModelSelectorGroup = (props: ModelSelectorGroupProps) => (
  <CommandGroup {...props} />
);

export type ModelSelectorItemProps = ComponentProps<typeof CommandItem>;

export const ModelSelectorItem = ({
  className,
  ...props
}: ModelSelectorItemProps) => (
  // Room for a second line (a reason it's unavailable); the mark, vendor and
  // checkmark stay on the first.
  <CommandItem className={cn("items-start rounded-md", className)} {...props} />
);

export type ModelSelectorShortcutProps = ComponentProps<typeof CommandShortcut>;

export const ModelSelectorShortcut = (props: ModelSelectorShortcutProps) => (
  <CommandShortcut {...props} />
);

export type ModelSelectorSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => (
  <CommandSeparator {...props} />
);

export type ModelSelectorLogoProps = Omit<
  ComponentProps<"span">,
  "children"
> & {
  /** The vendor's display name, for the letter mark when it has no logo. */
  readonly name?: string;
  /** The vendor id (`anthropic`), as `@workspace/icons/brands` lists it. */
  readonly provider: string;
};

/**
 * The vendor's monochrome logo, from `@workspace/icons/brands` (generated
 * from lobe-icons, never fetched), or a neutral letter mark for a vendor it
 * doesn't know. Upstream loads `models.dev/logos/<provider>.svg` at runtime.
 */
export const ModelSelectorLogo = ({
  provider,
  name,
  className,
  ...props
}: ModelSelectorLogoProps) => {
  const known = hasBrandMark(provider);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 select-none items-center justify-center",
        known
          ? "text-foreground"
          : "rounded-[4px] bg-muted font-medium text-[10px] text-muted-foreground uppercase leading-none ring-1 ring-border",
        className
      )}
      data-brand={known ? provider : undefined}
      data-slot="model-selector-logo"
      {...props}
    >
      {known ? (
        <BrandMark brand={provider} className="size-3.5" />
      ) : (
        (Array.from((name ?? provider).trim())[0] ?? "?")
      )}
    </span>
  );
};

export type ModelSelectorLogoGroupProps = ComponentProps<"div">;

export const ModelSelectorLogoGroup = ({
  className,
  ...props
}: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      "flex shrink-0 items-center -space-x-1 *:data-[slot=model-selector-logo]:ring-background",
      className
    )}
    {...props}
  />
);

export type ModelSelectorNameProps = ComponentProps<"span">;

export const ModelSelectorName = ({
  className,
  ...props
}: ModelSelectorNameProps) => (
  <span
    className={cn("flex-1 truncate text-start", className)}
    data-slot="model-selector-name"
    {...props}
  />
);

export type ModelSelectorVendorProps = ComponentProps<"span">;

/**
 * Who makes the row's model at the row's end: the name's size, set apart
 * only by its muted colour (105).
 */
export const ModelSelectorVendor = ({
  className,
  ...props
}: ModelSelectorVendorProps) => (
  <span
    className={cn(
      "ms-auto shrink-0 ps-2 text-muted-foreground leading-5",
      className
    )}
    data-slot="model-selector-vendor"
    {...props}
  />
);

// ---- The preview card's parts (099), for `ModelSelectorContent.preview`. ----

export type ModelSelectorPreviewTitleProps = ComponentProps<"div"> & {
  readonly icon?: ReactNode;
};

export const ModelSelectorPreviewTitle = ({
  children,
  className,
  icon,
  ...props
}: ModelSelectorPreviewTitleProps) => (
  <div
    className={cn(
      "flex min-w-0 items-center gap-2 font-medium text-foreground text-sm",
      className
    )}
    data-slot="model-selector-preview-title"
    {...props}
  >
    {icon}
    <span className="min-w-0 truncate">{children}</span>
  </div>
);

const STEPS = [1, 2, 3, 4, 5] as const;

export type ModelSelectorPreviewMeterProps = Omit<
  ComponentProps<"div">,
  "children"
> & {
  /** The visible label (`Speed`); also the meter's accessible name. */
  readonly label: string;
  /** 1–5. */
  readonly value: number;
  /** What a reader hears, like "3 of 5"; the label is said first. */
  readonly valueText: string;
};

/** A label over a five-step bar, filled to `value`. */
export const ModelSelectorPreviewMeter = ({
  className,
  label,
  value,
  valueText,
  ...props
}: ModelSelectorPreviewMeterProps) => (
  <div
    className={cn("flex flex-col gap-1", className)}
    data-slot="model-selector-preview-meter"
    {...props}
  >
    <span className="text-muted-foreground">{label}</span>
    {/* A real meter for assistive tech; the bar beside it is only drawn. */}
    <meter
      aria-label={label}
      aria-valuetext={valueText}
      className="sr-only"
      max={5}
      min={1}
      value={value}
    />
    <div aria-hidden className="flex gap-0.5">
      {STEPS.map((step) => (
        <span
          className={cn(
            "h-1 flex-1 first:rounded-s-full last:rounded-e-full",
            step <= value ? "bg-foreground" : "bg-muted"
          )}
          data-filled={step <= value}
          key={step}
        />
      ))}
    </div>
  </div>
);

export type ModelSelectorPreviewRowProps = ComponentProps<"div"> & {
  readonly icon?: ReactNode;
  /** Said but not stressed: something the model can't do. */
  readonly muted?: boolean;
};

/** One fact with an icon (`Vision`), or a label and value pair. */
export const ModelSelectorPreviewRow = ({
  children,
  className,
  icon,
  muted,
  ...props
}: ModelSelectorPreviewRowProps) => (
  <div
    className={cn(
      "flex min-w-0 items-center gap-2 [&_svg]:size-3.5 [&_svg]:shrink-0",
      muted ? "text-muted-foreground" : "text-foreground",
      className
    )}
    data-slot="model-selector-preview-row"
    {...props}
  >
    {icon}
    {children}
  </div>
);

export type ModelSelectorPreviewSectionProps = ComponentProps<"div">;

export const ModelSelectorPreviewSection = ({
  className,
  ...props
}: ModelSelectorPreviewSectionProps) => (
  <div
    className={cn("flex flex-col gap-1.5", className)}
    data-slot="model-selector-preview-section"
    {...props}
  />
);

export type ModelSelectorPreviewNoteProps = ComponentProps<"p">;

/** A quiet sentence: a description, or that there's nothing to show. */
export const ModelSelectorPreviewNote = ({
  className,
  ...props
}: ModelSelectorPreviewNoteProps) => (
  <p
    className={cn("text-muted-foreground leading-relaxed", className)}
    data-slot="model-selector-preview-note"
    {...props}
  />
);

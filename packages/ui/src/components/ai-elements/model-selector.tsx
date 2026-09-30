"use client";

// AI Elements' model selector (MIT, vercel/ai-elements
// `packages/elements/src/model-selector.tsx`), on our Base UI dialog and
// cmdk command. See this folder's README for what changed from upstream.

import { useLingui } from "@lingui/react/macro";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type ModelSelectorProps = ComponentProps<typeof Dialog>;

export const ModelSelector = (props: ModelSelectorProps) => (
  <Dialog {...props} />
);

export type ModelSelectorTriggerProps = ComponentProps<typeof DialogTrigger>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <DialogTrigger {...props} />
);

export type ModelSelectorContentProps = ComponentProps<typeof DialogContent> & {
  /** Props for the inner cmdk root (`shouldFilter`, `value`, `loop`, …). */
  readonly command?: Omit<ComponentProps<typeof Command>, "children">;
  readonly title?: ReactNode;
};

export const ModelSelectorContent = ({
  className,
  children,
  command,
  title,
  ...props
}: ModelSelectorContentProps) => {
  const { t } = useLingui();
  return (
    <DialogContent
      className={cn(
        // Top-anchored like the command palette, so a phone keyboard
        // rising under it doesn't push the search field off screen.
        "top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-xl! p-0 sm:max-w-md",
        className
      )}
      showCloseButton={false}
      {...props}
    >
      <DialogTitle className="sr-only">
        {title ?? t`Choose a model`}
      </DialogTitle>
      <Command
        {...command}
        className={cn(
          "**:data-[slot=command-input-wrapper]:h-auto",
          command?.className
        )}
      >
        {children}
      </Command>
    </DialogContent>
  );
};

export type ModelSelectorDialogProps = ComponentProps<typeof CommandDialog>;

export const ModelSelectorDialog = (props: ModelSelectorDialogProps) => (
  <CommandDialog {...props} />
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
    className={cn("max-h-[min(24rem,60vh)]", className)}
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
  // Room for a second line; the checkmark stays on the first.
  <CommandItem className={cn("items-start", className)} {...props} />
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
  /** The provider's display name; its first letter is the mark. */
  readonly provider: string;
};

/**
 * A neutral letter mark for a provider. Upstream loads each logo from
 * models.dev at runtime; we don't reach third-party hosts from the page
 * (D19 keeps icons in `@workspace/icons`, which has no brand marks).
 */
export const ModelSelectorLogo = ({
  provider,
  className,
  ...props
}: ModelSelectorLogoProps) => (
  <span
    aria-hidden
    className={cn(
      "inline-flex size-4 shrink-0 select-none items-center justify-center rounded-[4px] bg-muted font-medium text-[10px] text-muted-foreground uppercase leading-none ring-1 ring-border",
      className
    )}
    data-slot="model-selector-logo"
    {...props}
  >
    {Array.from(provider.trim())[0] ?? "?"}
  </span>
);

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
  <span className={cn("flex-1 truncate text-start", className)} {...props} />
);

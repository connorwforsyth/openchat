"use client";

import { Plural, Trans } from "@lingui/react/macro";
import { ChevronDownIcon, ReasoningIcon } from "@workspace/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { useStreamdownDefaults } from "./streamdown";

interface ReasoningContextValue {
  duration: number | undefined;
  isOpen: boolean;
  isStreaming: boolean;
  setIsOpen: (open: boolean) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    // A programming error (a part rendered outside its root), not a runtime
    // condition, so it throws like React's own context misuse does.
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = Omit<
  ComponentProps<typeof Collapsible>,
  "open" | "defaultOpen" | "onOpenChange"
> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    // Controlled when `open` is passed, self-managed otherwise. Radix's
    // useControllableState did this upstream; Base UI keeps its equivalent
    // internal, and the pattern is small enough to own.
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const isOpen = open ?? uncontrolledOpen;
    const setIsOpen = useCallback(
      (next: boolean) => {
        if (open === undefined) {
          setUncontrolledOpen(next);
        }
        onOpenChange?.(next);
      },
      [open, onOpenChange]
    );

    const [measuredDuration, setMeasuredDuration] = useState<
      number | undefined
    >(undefined);
    const duration = durationProp ?? measuredDuration;

    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);

    // Time the stream so the trigger can say how long the model thought.
    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now());
        }
      } else if (startTime !== null) {
        setMeasuredDuration(Math.ceil((Date.now() - startTime) / MS_IN_S));
        setStartTime(null);
      }
    }, [isStreaming, startTime]);

    // Close once after streaming ends, with a beat to see the last of it.
    useEffect(() => {
      if (defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed]);

    return (
      <ReasoningContext.Provider
        value={{ duration, isOpen, isStreaming, setIsOpen }}
      >
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return (
      <span className="shimmer">
        <Trans>Thinking…</Trans>
      </span>
    );
  }
  if (duration === undefined) {
    return (
      <span>
        <Trans>Thought for a few seconds</Trans>
      </span>
    );
  }
  return (
    <span>
      <Plural
        one="Thought for # second"
        other="Thought for # seconds"
        value={duration}
      />
    </span>
  );
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors duration-(--motion-fast) hover:text-foreground",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <ReasoningIcon className="size-4" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform duration-(--motion-fast) ease-motion-out",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

// Opens and closes at once, like `ToolContent` (D28: no height animation).
export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => {
    const defaults = useStreamdownDefaults();

    return (
      <CollapsibleContent
        className={cn(
          "mt-4 overflow-hidden text-muted-foreground text-sm outline-none",
          className
        )}
        {...props}
      >
        <Streamdown icons={defaults.icons} translations={defaults.translations}>
          {children}
        </Streamdown>
      </CollapsibleContent>
    );
  }
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";

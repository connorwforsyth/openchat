"use client";

import { Plural, Trans } from "@lingui/react/macro";
import { ReasoningIcon } from "@workspace/icons";
import { Markdown } from "@workspace/ui/components/markdown";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import { useEffect, useRef, useState } from "react";

const MS_IN_S = 1000;

/** How long the model thought, in whole seconds, once it has stopped. */
function useThinkingSeconds(streaming: boolean): number | undefined {
  const startedAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (streaming) {
      startedAt.current ??= Date.now();
      return;
    }
    if (startedAt.current !== null) {
      setSeconds(Math.ceil((Date.now() - startedAt.current) / MS_IN_S));
      startedAt.current = null;
    }
  }, [streaming]);

  return seconds;
}

function ThinkingTitle({
  seconds,
  streaming,
}: {
  readonly seconds: number | undefined;
  readonly streaming: boolean;
}) {
  if (streaming || seconds === 0) {
    return <Trans>Thinking…</Trans>;
  }
  if (seconds === undefined) {
    return <Trans>Thought for a few seconds</Trans>;
  }
  return (
    <Plural
      one="Thought for # second"
      other="Thought for # seconds"
      value={seconds}
    />
  );
}

/**
 * The model's thinking as a Trace line (shadcn's Reasoning pattern): open
 * while it streams, closed once it's done, unless the person opened or closed
 * it themselves. Loaded through `LazyReasoning` (D27): most turns never open
 * it.
 */
export function ReasoningPart({
  streaming,
  text,
}: {
  readonly streaming: boolean;
  readonly text: string;
}) {
  const seconds = useThinkingSeconds(streaming);
  const [open, setOpen] = useState<boolean | undefined>(undefined);

  // The line's `running` status pulses the title while it streams.
  const line = (
    <TraceLine status={streaming ? "running" : undefined}>
      <TraceIcon>
        <ReasoningIcon />
      </TraceIcon>
      <TraceTitle>
        <ThinkingTitle seconds={seconds} streaming={streaming} />
      </TraceTitle>
    </TraceLine>
  );

  return (
    <Trace className="not-prose">
      {text.length === 0 ? (
        line
      ) : (
        <TraceCollapsible onOpenChange={setOpen} open={open ?? streaming}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="text-sm">
            <Markdown>{text}</Markdown>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  );
}

"use client";

import { Plural, Trans } from "@lingui/react/macro";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";

import { ThinkingLabel } from "./thinking";

// The trigger's label, as AI Elements words it, but with the pulsing
// "Thinking…" the rest of the conversation uses instead of its shimmer.
const thinkingMessage = (streaming: boolean, duration?: number) => {
  if (streaming || duration === 0) {
    return <ThinkingLabel />;
  }
  if (duration === undefined) {
    return <Trans>Thought for a few seconds</Trans>;
  }
  return (
    <Plural
      one="Thought for # second"
      other="Thought for # seconds"
      value={duration}
    />
  );
};

/**
 * The model's thinking, collapsed unless it's streaming right now. Loaded
 * through `LazyReasoning` (D27): most turns never open it.
 */
export function ReasoningPart({
  streaming,
  text,
}: {
  readonly streaming: boolean;
  readonly text: string;
}) {
  return (
    <Reasoning className="mb-0" defaultOpen={streaming} isStreaming={streaming}>
      <ReasoningTrigger getThinkingMessage={thinkingMessage} />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

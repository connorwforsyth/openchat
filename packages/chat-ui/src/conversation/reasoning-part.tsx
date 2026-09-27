"use client";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";

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
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

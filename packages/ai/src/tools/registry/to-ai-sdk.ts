import { type Tool, tool } from "ai";

import type { ToolDefinition, ToolRunContext } from "./define";

// The one place a definition meets the AI SDK: `ToolLoopAgent` takes a
// `ToolSet`, and this makes its entries. The SDK's per-call options become
// our context's `signal` and `toolCallId`; everything else in the context
// was bound for the run.

/** The run's bindings, required only when the definition needs some. */
type RunArgs<Run extends ToolRunContext> =
  Record<never, never> extends Run ? readonly [run?: Run] : readonly [run: Run];

export const toAiSdkTool = <Input, Output, Run extends ToolRunContext>(
  definition: ToolDefinition<Input, Output, Run>,
  ...[run]: RunArgs<Run>
): Tool => {
  if (definition.sdkTool) {
    return definition.sdkTool;
  }
  const { description, input, output } = definition;
  const bound = (run ?? {}) as Run;
  // Only the keys the definition has: a client tool must stay without
  // `execute`, which is how the loop knows to stop at its call.
  return tool({
    description,
    ...(definition.execute
      ? {
          execute: (
            value: Input,
            options: { abortSignal?: AbortSignal; toolCallId: string }
          ) =>
            definition.execute?.(value, {
              ...bound,
              signal: options.abortSignal,
              toolCallId: options.toolCallId,
            }),
        }
      : {}),
    inputSchema: input,
    ...(output ? { outputSchema: output } : {}),
    ...(definition.modelText
      ? {
          toModelOutput: ({ output: value }: { output: Output }) => ({
            type: "text" as const,
            value: definition.modelText?.(value) ?? "",
          }),
        }
      : {}),
  } as Tool);
};

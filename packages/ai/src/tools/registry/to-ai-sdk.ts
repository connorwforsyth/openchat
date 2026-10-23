import { type Tool, tool } from "ai";

import type { ToolDefinition, ToolModelFile, ToolRunContext } from "./define";

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
  const { description, input, modelText, output } = definition;
  const bound = (run ?? {}) as Run;
  // What `execute` showed the model, by call. It lives as long as these
  // tools (one run), so a call from an earlier run is shown as text.
  const shown = new Map<string, ToolModelFile[]>();
  const show = (toolCallId: string) => (file: ToolModelFile) => {
    shown.set(toolCallId, [...(shown.get(toolCallId) ?? []), file]);
  };
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
              ...(modelText ? { show: show(options.toolCallId) } : {}),
              signal: options.abortSignal,
              toolCallId: options.toolCallId,
            }),
        }
      : {}),
    inputSchema: input,
    ...(output ? { outputSchema: output } : {}),
    ...(modelText
      ? {
          toModelOutput: ({
            output: value,
            toolCallId,
          }: {
            output: Output;
            toolCallId: string;
          }) => {
            const text = modelText(value);
            const files = shown.get(toolCallId);
            return files
              ? {
                  type: "content" as const,
                  value: [
                    { text, type: "text" as const },
                    ...files.map(({ data, mediaType }) => ({
                      data: { data, type: "data" as const },
                      mediaType,
                      type: "file" as const,
                    })),
                  ],
                }
              : { type: "text" as const, value: text };
          },
        }
      : {}),
  } as Tool);
};

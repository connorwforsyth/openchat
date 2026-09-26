import type {
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";

// Scripted replies for `MockLanguageModelV4` (tests only). Nothing here calls
// a provider; see AGENTS.md "Testing".

export const usage = (input = 10, output = 5): LanguageModelV4Usage => ({
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: input,
    total: input,
  },
  outputTokens: { reasoning: undefined, text: output, total: output },
});

const finish = (
  reason: "stop" | "tool-calls" = "stop",
  tokens = usage()
): LanguageModelV4StreamPart => ({
  finishReason: { raw: reason, unified: reason },
  type: "finish",
  usage: tokens,
});

export const streamOf = (
  parts: readonly LanguageModelV4StreamPart[]
): LanguageModelV4StreamResult => ({
  stream: simulateReadableStream({ chunkDelayInMs: null, chunks: [...parts] }),
});

export const textStream = (
  text: string,
  tokens = usage()
): LanguageModelV4StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { id: "t1", type: "text-start" },
    { delta: text, id: "t1", type: "text-delta" },
    { id: "t1", type: "text-end" },
    finish("stop", tokens),
  ]);

export const toolCallStream = (
  toolName: string,
  input: unknown,
  toolCallId = "call-1"
): LanguageModelV4StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { input: JSON.stringify(input), toolCallId, toolName, type: "tool-call" },
    finish("tool-calls"),
  ]);

export const generated = (
  content: LanguageModelV4Content[],
  tokens = usage()
): LanguageModelV4GenerateResult => ({
  content,
  finishReason: { raw: "stop", unified: "stop" },
  usage: tokens,
  warnings: [],
});

export const readAll = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const chunks: T[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<T>) {
    chunks.push(chunk);
  }
  return chunks;
};

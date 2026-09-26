import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

// Recorded model streams for one tool round trip, in the shapes two provider
// families produce once their AI SDK providers normalise them: OpenAI's chat
// API streams the tool input in deltas under a `call_…` id and finishes with
// `tool_calls`; Anthropic's messages API thinks first, uses `toolu_…` ids
// and finishes with `tool_use`. Step 1 calls `get_weather`; step 2 answers
// from its result. Re-record when a provider package changes its parts.

export interface ToolCallingFixture {
  /** The tool call id the provider issued. */
  readonly callId: string;
  readonly steps: readonly [
    readonly LanguageModelV4StreamPart[],
    readonly LanguageModelV4StreamPart[],
  ];
}

const usage = (input: number, output: number) => ({
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: input,
    total: input,
  },
  outputTokens: { reasoning: undefined, text: output, total: output },
});

const answer = (
  chunks: readonly string[],
  raw: string
): LanguageModelV4StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { id: "txt-0", type: "text-start" },
  ...chunks.map(
    (delta): LanguageModelV4StreamPart => ({
      delta,
      id: "txt-0",
      type: "text-delta",
    })
  ),
  { id: "txt-0", type: "text-end" },
  {
    finishReason: { raw, unified: "stop" },
    type: "finish",
    usage: usage(64, 12),
  },
];

export const TOOL_CALLING_FIXTURES: Readonly<
  Record<"anthropic-messages" | "openai-chat", ToolCallingFixture>
> = {
  "anthropic-messages": {
    callId: "toolu_01A09q90qw90lq917835lq9",
    steps: [
      [
        { type: "stream-start", warnings: [] },
        {
          id: "rs-0",
          providerMetadata: { anthropic: { signature: "sig-recorded" } },
          type: "reasoning-start",
        },
        {
          delta: "The user wants the weather; I'll look it up.",
          id: "rs-0",
          type: "reasoning-delta",
        },
        { id: "rs-0", type: "reasoning-end" },
        {
          id: "toolu_01A09q90qw90lq917835lq9",
          toolName: "get_weather",
          type: "tool-input-start",
        },
        {
          delta: '{"city": "Li',
          id: "toolu_01A09q90qw90lq917835lq9",
          type: "tool-input-delta",
        },
        {
          delta: 'sbon"}',
          id: "toolu_01A09q90qw90lq917835lq9",
          type: "tool-input-delta",
        },
        { id: "toolu_01A09q90qw90lq917835lq9", type: "tool-input-end" },
        {
          input: '{"city": "Lisbon"}',
          toolCallId: "toolu_01A09q90qw90lq917835lq9",
          toolName: "get_weather",
          type: "tool-call",
        },
        {
          finishReason: { raw: "tool_use", unified: "tool-calls" },
          type: "finish",
          usage: usage(412, 58),
        },
      ],
      answer(["It's 21°C and ", "sunny in Lisbon."], "end_turn"),
    ],
  },
  "openai-chat": {
    callId: "call_9mYbXq3kP2Lr8sT1",
    steps: [
      [
        { type: "stream-start", warnings: [] },
        {
          id: "call_9mYbXq3kP2Lr8sT1",
          toolName: "get_weather",
          type: "tool-input-start",
        },
        {
          delta: '{"ci',
          id: "call_9mYbXq3kP2Lr8sT1",
          type: "tool-input-delta",
        },
        {
          delta: 'ty":"Lisbon"}',
          id: "call_9mYbXq3kP2Lr8sT1",
          type: "tool-input-delta",
        },
        { id: "call_9mYbXq3kP2Lr8sT1", type: "tool-input-end" },
        {
          input: '{"city":"Lisbon"}',
          toolCallId: "call_9mYbXq3kP2Lr8sT1",
          toolName: "get_weather",
          type: "tool-call",
        },
        {
          finishReason: { raw: "tool_calls", unified: "tool-calls" },
          type: "finish",
          usage: usage(96, 17),
        },
      ],
      answer(["It's 21°C", " and sunny in Lisbon."], "stop"),
    ],
  },
};

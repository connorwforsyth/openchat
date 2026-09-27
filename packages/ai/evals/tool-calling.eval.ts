import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { evalite } from "evalite";
import { z } from "zod";

import { runAgent } from "../src/agent/run-agent";
import { readAll } from "../src/testing/mock-models";
import { passes, sameJson } from "./core/scorers";
import { TOOL_CALLING_FIXTURES } from "./tool-calling/fixtures";

// Dev eval (D21): a tool call round-trips through `runAgent` whatever shape
// the provider streams it in. Step 1's call is parsed and executed, its
// result reaches the model in step 2, and the answer settles the run.

type Provider = keyof typeof TOOL_CALLING_FIXTURES;

interface RoundTrip {
  readonly executedWith: readonly unknown[];
  readonly finalText: string;
  /** The tool result as the model saw it in step 2's prompt. */
  readonly resultInPrompt: unknown;
  readonly status: string;
}

const WEATHER = { city: "Lisbon", condition: "sunny", tempC: 21 };

const roundTrip = async (provider: Provider): Promise<RoundTrip> => {
  const fixture = TOOL_CALLING_FIXTURES[provider];
  const executedWith: unknown[] = [];
  const model = new MockLanguageModelV4({
    doStream: fixture.steps.map((parts) => ({
      stream: simulateReadableStream({
        chunkDelayInMs: null,
        chunks: [...parts],
      }),
    })),
  });
  const run = await runAgent({
    messages: [
      {
        id: "u1",
        parts: [{ text: "What's the weather in Lisbon?", type: "text" }],
        role: "user",
      },
    ],
    model,
    tools: {
      get_weather: tool({
        description: "Current weather for a city.",
        execute: (input) => {
          executedWith.push(input);
          return WEATHER;
        },
        inputSchema: z.object({ city: z.string() }),
      }),
    },
  });
  if (!run.ok) {
    throw new Error(run.error.message);
  }
  await readAll(run.value.stream);
  const outcome = await run.value.outcome;
  const toolMessage = model.doStreamCalls[1]?.prompt.find(
    (message) => message.role === "tool"
  );
  const result =
    toolMessage?.role === "tool"
      ? toolMessage.content.find(
          (part) =>
            part.type === "tool-result" && part.toolCallId === fixture.callId
        )
      : undefined;
  return {
    executedWith,
    finalText: outcome.message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(""),
    resultInPrompt: result?.type === "tool-result" ? result.output : undefined,
    status: outcome.status,
  };
};

evalite<Provider, RoundTrip>("Tool calls round-trip through runAgent", {
  data: (Object.keys(TOOL_CALLING_FIXTURES) as Provider[]).map((input) => ({
    input,
  })),
  scorers: [
    passes("executed once with parsed input", (output) =>
      sameJson(output.executedWith, [{ city: "Lisbon" }])
        ? true
        : `executed with ${JSON.stringify(output.executedWith)}`
    ),
    passes("result reached the model", (output) =>
      sameJson(output.resultInPrompt, { type: "json", value: WEATHER })
        ? true
        : `step 2 saw ${JSON.stringify(output.resultInPrompt)}`
    ),
    passes("answered and settled", (output) =>
      output.status === "succeeded" &&
      output.finalText === "It's 21°C and sunny in Lisbon."
        ? true
        : `${output.status}: "${output.finalText}"`
    ),
  ],
  task: roundTrip,
});

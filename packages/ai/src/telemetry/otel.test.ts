import {
  InMemorySpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { generateText, type Telemetry } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generated } from "../testing/mock-models";
import { startTelemetry } from "./otel";

const PROMPT = "my cat is called Biscuit";
const ANSWER = "Biscuit is a lovely name";

const configured = {
  otlp: { endpoint: "http://collector.test:4318/v1/traces", headers: {} },
  serviceName: "web-test",
};

/** Runs one traced call through `integration` and returns the exported spans. */
const traced = async (recordContent: boolean) => {
  const exporter = new InMemorySpanExporter();
  let integration: Telemetry | undefined;
  const handle = startTelemetry(configured, {
    exporter,
    recordContent,
    register: (registered) => {
      integration = registered;
    },
  });
  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: generated([{ text: ANSWER, type: "text" }]),
    }),
    prompt: PROMPT,
    telemetry: { integrations: integration ? [integration] : [] },
  });
  await handle.flush();
  const spans = exporter.getFinishedSpans();
  await handle.shutdown();
  return spans;
};

const attributeText = (spans: readonly ReadableSpan[]) =>
  JSON.stringify(spans.map((span) => span.attributes));

afterEach(() => {
  globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = undefined;
});

describe("startTelemetry", () => {
  it("is a no-op without `observability.otlp`", async () => {
    const register = vi.fn();
    const handle = startTelemetry(
      { otlp: null, serviceName: "web" },
      { register }
    );
    expect(handle.enabled).toBe(false);
    expect(register).not.toHaveBeenCalled();
    startTelemetry({ otlp: null, serviceName: "web" });
    expect(globalThis.AI_SDK_TELEMETRY_INTEGRATIONS).toBeUndefined();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("exports spans with no message content by default", async () => {
    const spans = await traced(false);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]?.resource.attributes["service.name"]).toBe("web-test");
    const text = attributeText(spans);
    expect(text).toContain("mock-model-id");
    expect(text).not.toContain("Biscuit");
  });

  it("records content only when a deployment opts in", async () => {
    expect(attributeText(await traced(true))).toContain(PROMPT);
  });

  it("registers globally and unregisters on shutdown", async () => {
    const handle = startTelemetry(configured, {
      exporter: new InMemorySpanExporter(),
    });
    expect(handle.enabled).toBe(true);
    expect(globalThis.AI_SDK_TELEMETRY_INTEGRATIONS).toHaveLength(1);
    await handle.shutdown();
    expect(globalThis.AI_SDK_TELEMETRY_INTEGRATIONS).toEqual([]);
  });
});

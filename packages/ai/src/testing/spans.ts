import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

import { startTelemetry } from "../telemetry/otel";

/**
 * Turns telemetry on as an instance with `observability.otlp` would, and
 * hands back the spans every AI SDK call made until `stop`.
 */
export const captureSpans = () => {
  const exporter = new InMemorySpanExporter();
  const handle = startTelemetry(
    {
      otlp: { endpoint: "http://collector.test:4318/v1/traces", headers: {} },
      serviceName: "test",
    },
    { exporter }
  );
  return {
    stop: async (): Promise<ReadableSpan[]> => {
      await handle.flush();
      const spans = exporter.getFinishedSpans();
      await handle.shutdown();
      return spans;
    },
  };
};

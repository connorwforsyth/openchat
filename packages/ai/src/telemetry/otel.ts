import { OpenTelemetry } from "@ai-sdk/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { AppConfig } from "@workspace/config/schema";
import { registerTelemetry, type Telemetry } from "ai";

// Developer and ops tracing (D21): AI SDK telemetry exported over OTLP to
// whatever `observability.otlp` names (Langfuse, Phoenix, any collector).
// Off by default, and with no config nothing is registered, so the SDK's
// telemetry stays a no-op.
//
// Spans carry timings, models, token counts and tool names, never message
// content: prompts and outputs are user data and belong in our Postgres,
// under our permissions. `recordContent` opts in, for a developer's own
// instance.

export interface TelemetryHandle {
  readonly enabled: boolean;
  /** Exports whatever is buffered (tests, and before a serverless freeze). */
  readonly flush: () => Promise<void>;
  /** Flushes, stops exporting and unregisters from the AI SDK. */
  readonly shutdown: () => Promise<void>;
}

export interface StartTelemetryOptions {
  /** Replaces the OTLP exporter (tests pass an in-memory one). */
  readonly exporter?: SpanExporter;
  /** Record prompts and outputs on spans. Off unless a deployment opts in. */
  readonly recordContent?: boolean;
  /** Where the integration goes; defaults to the AI SDK's global registry. */
  readonly register?: (integration: Telemetry) => void;
  /** Export failures, for logs. Never includes headers (they carry tokens). */
  readonly report?: (message: string, cause: unknown) => void;
}

/** `onStart`, `onStepEnd`, `experimental_onEvaluateStart`…: the callbacks that receive events. */
const EVENT_CALLBACK = /^(experimental_)?on[A-Z]/;

const disabled: TelemetryHandle = {
  enabled: false,
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

/**
 * The integration with every event marked "don't record inputs or
 * outputs", whatever the call asked for. Events are copied the way the SDK
 * copies them (same prototype), so getters on step results keep working.
 */
export const withoutContent = (integration: Telemetry): Telemetry =>
  new Proxy(integration, {
    get: (target, key, receiver) => {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const method = value as (...args: unknown[]) => unknown;
      if (typeof key !== "string" || !EVENT_CALLBACK.test(key)) {
        return method.bind(target);
      }
      return (event: object) =>
        method.call(
          target,
          Object.assign(Object.create(Object.getPrototypeOf(event)), event, {
            recordInputs: false,
            recordOutputs: false,
          })
        );
    },
  });

const unregister = (integration: Telemetry) => {
  const registered = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
  if (registered) {
    globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = registered.filter(
      (item) => item !== integration
    );
  }
};

export const startTelemetry = (
  observability: AppConfig["observability"],
  options: StartTelemetryOptions = {}
): TelemetryHandle => {
  const { otlp } = observability;
  if (!otlp) {
    return disabled;
  }
  const report = options.report ?? (() => undefined);
  const exporter =
    options.exporter ??
    new OTLPTraceExporter({ headers: otlp.headers, url: otlp.endpoint });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": observability.serviceName,
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  const otel = new OpenTelemetry({ tracer: provider.getTracer("ai") });
  const integration = options.recordContent ? otel : withoutContent(otel);
  const register = options.register ?? registerTelemetry;
  register(integration);

  return {
    enabled: true,
    flush: () =>
      provider
        .forceFlush()
        .catch((cause: unknown) => report("couldn't export traces", cause)),
    shutdown: async () => {
      unregister(integration);
      await provider
        .shutdown()
        .catch((cause: unknown) => report("couldn't export traces", cause));
    },
  };
};

import type { ImageModelV4, ImageModelV4CallOptions } from "@ai-sdk/provider";
import { MockImageModelV4 } from "ai/test";

// A mock image model (138) for tests and evals: it draws the same 1×1 PNG
// however many times it's asked, and records each call. Nothing here calls
// a provider; see AGENTS.md "Testing".

/** A valid 1×1 PNG, base64. */
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const tinyPng = (): Uint8Array =>
  Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));

export interface MockImageModel {
  readonly calls: ImageModelV4CallOptions[];
  readonly model: ImageModelV4;
}

/** An image model that answers every call with `n` tiny PNGs, or throws `fail`. */
export const mockImageModel = ({
  fail,
  modelId = "pixel",
}: {
  readonly fail?: Error;
  readonly modelId?: string;
} = {}): MockImageModel => {
  const calls: ImageModelV4CallOptions[] = [];
  const model = new MockImageModelV4({
    doGenerate: (options) => {
      calls.push(options);
      if (fail) {
        return Promise.reject(fail);
      }
      return Promise.resolve({
        images: Array.from({ length: options.n }, () => TINY_PNG_BASE64),
        response: { headers: undefined, modelId, timestamp: new Date(0) },
        usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 },
        warnings: [],
      });
    },
    maxImagesPerCall: 4,
    modelId,
    provider: "mock",
  });
  return { calls, model };
};

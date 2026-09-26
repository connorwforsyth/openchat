import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";

import { toRunError } from "./run-error";

const apiError = (statusCode: number | undefined, responseBody = "") =>
  new APICallError({
    message: "provider said no",
    requestBodyValues: {},
    responseBody,
    statusCode,
    url: "https://provider.example/v1",
  });

describe("toRunError", () => {
  it.each([
    [apiError(429), "rate_limited", true],
    [apiError(401, "invalid x-api-key sk-live-1234"), "provider_error", false],
    [
      apiError(400, "prompt is too long: 300000 tokens"),
      "context_too_long",
      false,
    ],
    [apiError(400, "bad request"), "provider_error", false],
    [apiError(503), "provider_unavailable", true],
    [apiError(undefined), "provider_unavailable", true],
    [new DOMException("aborted", "AbortError"), "timeout", true],
    [new Error("boom"), "internal", false],
  ])("maps %s", (error, code, retryable) => {
    expect(toRunError(error)).toMatchObject({ code, retryable });
  });

  it("unwraps retries and never echoes the provider's body", () => {
    const wrapped = new RetryError({
      errors: [apiError(401, "key sk-live-1234 is invalid")],
      message: "failed after retries",
      reason: "maxRetriesExceeded",
    });
    const mapped = toRunError(wrapped);
    expect(mapped.code).toBe("provider_error");
    expect(mapped.message).not.toContain("sk-live");
  });
});

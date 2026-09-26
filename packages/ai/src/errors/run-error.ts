import type { RunError } from "@workspace/contract/schemas/runs";
import { APICallError, RetryError } from "ai";

// Any failure from a model call as a `RunError`, which is safe to show: the
// message is ours, never the provider's response body (it can echo a key
// prefix or someone's prompt). Details go to logs and traces, not here.

const CONTEXT_TOO_LONG =
  /context(?:[ _-]length|[ _-]window)|too many tokens|prompt is too long/i;

const NETWORK_FAILURE = /fetch|network|ECONNREFUSED/i;

const isAbort = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" || error.name === "TimeoutError");

const fromStatus = (status: number | undefined, text: string): RunError => {
  if (status === 429) {
    return {
      code: "rate_limited",
      message: "The model provider is rate limiting requests.",
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: "provider_error",
      message: "The model provider rejected the key for this chat.",
      retryable: false,
    };
  }
  if ((status === 400 || status === 413) && CONTEXT_TOO_LONG.test(text)) {
    return {
      code: "context_too_long",
      message: "The conversation is too long for this model.",
      retryable: false,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      code: "provider_unavailable",
      message: "The model provider is unavailable. Try again shortly.",
      retryable: true,
    };
  }
  return {
    code: "provider_error",
    message: "The model provider returned an error.",
    retryable: false,
  };
};

export const toRunError = (error: unknown): RunError => {
  if (RetryError.isInstance(error)) {
    return toRunError(error.lastError);
  }
  if (APICallError.isInstance(error)) {
    // No status means the request never got an answer (DNS, refused, reset).
    if (error.statusCode === undefined) {
      return {
        code: "provider_unavailable",
        message: "Couldn't reach the model provider.",
        retryable: true,
      };
    }
    return fromStatus(
      error.statusCode,
      `${error.message} ${error.responseBody ?? ""}`
    );
  }
  if (isAbort(error)) {
    return {
      code: "timeout",
      message: "The model took too long to answer.",
      retryable: true,
    };
  }
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) {
    return {
      code: "provider_unavailable",
      message: "Couldn't reach the model provider.",
      retryable: true,
    };
  }
  return {
    code: "internal",
    message: "Something went wrong running the model.",
    retryable: false,
  };
};

import { llmProxyErrors } from "@workspace/contract/errors";

import type { ValidationIssue } from "./prompt";

// `POST /api/llm` isn't an oRPC procedure, so it builds oRPC's error bodies
// itself (`{ defined, code, status, message, data }`), from the contract's
// `llmProxyErrors`. The handler returns the three it can decide; the route
// adds auth, context membership, rate limits and budgets before calling it,
// with the same helper.

export type LlmProxyError =
  | {
      readonly code: "BAD_REQUEST";
      readonly data: { readonly issues: readonly ValidationIssue[] };
    }
  | {
      readonly code: "VALIDATION";
      readonly data: { readonly issues: readonly ValidationIssue[] };
    }
  | {
      readonly code: "PROVIDER_UNAVAILABLE";
      readonly data: { readonly provider: string | null };
    }
  | {
      readonly code: "RATE_LIMITED";
      readonly data: { readonly retryAfterSeconds: number };
    }
  | { readonly code: "FORBIDDEN" | "UNAUTHORIZED"; readonly data?: undefined }
  | {
      readonly code: "BUDGET_EXCEEDED" | "ALLOWANCE_SPENT";
      readonly data: Readonly<Record<string, unknown>>;
    };

export const validation = (
  issues: readonly ValidationIssue[]
): LlmProxyError => ({
  code: "VALIDATION",
  data: { issues },
});

const BAD_REQUEST = {
  message: "The request body is invalid.",
  status: 400,
} as const;

export const llmProxyErrorBody = (error: LlmProxyError) => {
  const { message, status } =
    error.code === "BAD_REQUEST" ? BAD_REQUEST : llmProxyErrors[error.code];
  return {
    body: {
      code: error.code,
      data: error.data,
      // oRPC marks errors a procedure declares; BAD_REQUEST is its own.
      defined: error.code !== "BAD_REQUEST",
      message,
      status,
    },
    status,
  };
};

export const llmProxyErrorResponse = (error: LlmProxyError): Response => {
  const { body, status } = llmProxyErrorBody(error);
  return Response.json(body, { status });
};

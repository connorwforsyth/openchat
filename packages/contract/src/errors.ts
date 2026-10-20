import { z } from "zod";

import { microUsdSchema } from "./schemas/common";
import { healthSchema } from "./schemas/health";
import { principalSchema } from "./schemas/tenancy";
import { budgetPeriodSchema } from "./schemas/usage";

// Typed errors (D8, D26). Handlers throw `errors.<CODE>(...)` from the oRPC
// context; clients switch on `error.code` and get typed `data`. Input that
// fails the contract's zod schemas never reaches a handler: oRPC answers
// `BAD_REQUEST` (400) with the issues. `VALIDATION` (422) is for input that
// parses but breaks a domain rule the schema can't express (a grant level
// that doesn't fit the resource type, a skill path that already exists).

/** Why a `CONFLICT` happened, so clients can react without parsing messages. */
export const conflictReasonSchema = z.enum([
  "context_locked",
  "version_mismatch",
  "already_exists",
  "team_cycle",
  "run_finished",
  "not_awaiting_approval",
  "last_owner",
  "run_active",
  "not_empty",
  "schedule_completed",
  "target_archived",
]);
export type ConflictReason = z.infer<typeof conflictReasonSchema>;

export const validationIssueSchema = z.object({
  message: z.string(),
  /** Path into the input, like `["definition", "tools", 2]`. */
  path: z.array(z.union([z.string(), z.int()])),
});

export const budgetExceededDataSchema = z.object({
  limitMicros: microUsdSchema,
  period: budgetPeriodSchema,
  principal: principalSchema,
  resetsAt: z.iso.datetime({ offset: true }),
  usedMicros: microUsdSchema,
});

/** Errors any authenticated procedure can return. */
export const baseErrors = {
  FORBIDDEN: {
    message: "You don't have access to this.",
    status: 403,
  },
  NOT_FOUND: {
    message: "Not found.",
    status: 404,
  },
  RATE_LIMITED: {
    data: z.object({ retryAfterSeconds: z.int().min(0) }),
    message: "Too many requests.",
    status: 429,
  },
  UNAUTHORIZED: {
    message: "Sign in to continue.",
    status: 401,
  },
  VALIDATION: {
    data: z.object({ issues: z.array(validationIssueSchema).min(1) }),
    message: "The request breaks a rule.",
    status: 422,
  },
} as const;

export const conflictError = {
  CONFLICT: {
    data: z.object({ reason: conflictReasonSchema }),
    message: "The request conflicts with the current state.",
    status: 409,
  },
} as const;

/** Before a run is created (D24): the user's, team's or org's budget is spent. */
export const budgetError = {
  BUDGET_EXCEEDED: {
    data: budgetExceededDataSchema,
    message: "The budget for this period is spent.",
    status: 402,
  },
} as const;

/** No model or key is available for the requested target in this context. */
export const providerError = {
  PROVIDER_UNAVAILABLE: {
    data: z.object({ provider: z.string().nullable() }),
    message: "No model provider is available for this request.",
    status: 503,
  },
} as const;

/** The instance turned the feature off in app.config.yaml `features`. */
export const featureError = {
  FEATURE_DISABLED: {
    data: z.object({ feature: z.string() }),
    message: "This feature is turned off on this instance.",
    status: 403,
  },
} as const;

/**
 * The server has no usable `ENCRYPTION_KEY`, so it can't seal a secret
 * (provider keys) for storage. An operator fixes it; the user can't.
 */
export const encryptionError = {
  ENCRYPTION_UNAVAILABLE: {
    message: "This server can't store secrets until ENCRYPTION_KEY is set.",
    status: 503,
  },
} as const;

/** `GET /health?ready=true` while a dependency is down; `data` is the health report. */
export const readinessError = {
  NOT_READY: {
    data: healthSchema,
    message: "The server is up but not ready.",
    status: 503,
  },
} as const;

/**
 * What `POST /api/llm` can answer before a response starts, in the same
 * bodies procedures use. It isn't a procedure, so the server builds these
 * itself and `openapi.ts` documents them. `FORBIDDEN` covers a context the
 * caller isn't in or one the instance disallows; `VALIDATION` a model that
 * doesn't resolve or can't take the request (tools on a model without them).
 */
export const llmProxyErrors = {
  BUDGET_EXCEEDED: budgetError.BUDGET_EXCEEDED,
  FORBIDDEN: baseErrors.FORBIDDEN,
  PROVIDER_UNAVAILABLE: providerError.PROVIDER_UNAVAILABLE,
  RATE_LIMITED: baseErrors.RATE_LIMITED,
  UNAUTHORIZED: baseErrors.UNAUTHORIZED,
  VALIDATION: baseErrors.VALIDATION,
} as const;

/**
 * Every error code the API can return, for exhaustive client handling.
 * `BAD_REQUEST` is oRPC's own, for input that fails the schema. A test keeps
 * this list in step with the maps above.
 */
export const errorCodeSchema = z.enum([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
  "FEATURE_DISABLED",
  "ENCRYPTION_UNAVAILABLE",
  "NOT_READY",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

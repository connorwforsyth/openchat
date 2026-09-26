import { validationIssueSchema } from "@workspace/contract/errors";
import { z } from "zod";

// What the knowledge handlers return instead of throwing (D8). The codes
// are the contract's typed errors, so the oRPC mount (ticket 025) turns one
// into `errors[code](...)` with its `data`. `UNAVAILABLE` is the exception:
// storage or the embedding provider is down, which isn't the caller's
// doing, so the shell answers it as a 503 rather than a typed error.

export const knowledgeErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("NOT_FOUND") }),
  z.object({ code: z.literal("FORBIDDEN") }),
  z.object({
    code: z.literal("FEATURE_DISABLED"),
    data: z.object({ feature: z.string() }),
  }),
  z.object({
    code: z.literal("VALIDATION"),
    data: z.object({ issues: z.array(validationIssueSchema).min(1) }),
  }),
  z.object({ code: z.literal("UNAVAILABLE"), message: z.string() }),
]);
export type KnowledgeError = z.infer<typeof knowledgeErrorSchema>;

export const notFound: KnowledgeError = { code: "NOT_FOUND" };
export const forbidden: KnowledgeError = { code: "FORBIDDEN" };

export const invalid = (
  path: (string | number)[],
  message: string
): KnowledgeError => ({
  code: "VALIDATION",
  data: { issues: [{ message, path }] },
});

export const featureDisabled = (feature: string): KnowledgeError => ({
  code: "FEATURE_DISABLED",
  data: { feature },
});

export const unavailable = (message: string): KnowledgeError => ({
  code: "UNAVAILABLE",
  message,
});

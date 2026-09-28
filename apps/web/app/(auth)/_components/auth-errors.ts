import { signUpRefusalSchema } from "@workspace/auth/signup";
import { z } from "zod";

// What went wrong with a sign-in or sign-up, as a reason the page can say in
// the user's language. Better Auth answers `{ error: { code, message } }`;
// codes vary in case between endpoints, so they're compared upper-cased.

export const authProblemSchema = z.enum([
  "wrong_credentials",
  "email_taken",
  "weak_password",
  "invite_required",
  "domain_not_allowed",
  "sso_required",
  "invalid_email",
  "password_too_long",
  /** The page's address isn't a trusted origin (054): open the app's own. */
  "origin_rejected",
  "rate_limited",
  /** The request never got an answer: offline, or the server is down. */
  "unreachable",
  "server_error",
  "unavailable",
  "failed",
]);
export type AuthProblem = z.infer<typeof authProblemSchema>;

const errorSchema = z.object({
  code: z.string().optional(),
  status: z.number().optional(),
});

const BY_CODE: Readonly<Record<string, AuthProblem>> = {
  INVALID_EMAIL: "invalid_email",
  INVALID_EMAIL_OR_PASSWORD: "wrong_credentials",
  // Better Auth's origin check; a missing Origin is the same fix.
  INVALID_ORIGIN: "origin_rejected",
  MISSING_OR_NULL_ORIGIN: "origin_rejected",
  PASSWORD_TOO_LONG: "password_too_long",
  PASSWORD_TOO_SHORT: "weak_password",
  USER_ALREADY_EXISTS: "email_taken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "email_taken",
};

/** Problems known only by their status, after the codes above. */
const byStatus = (status: number | undefined): AuthProblem => {
  if (status === undefined) {
    return "failed";
  }
  // 404/503: no auth handler behind `/api/auth` (no database or no secret).
  if (status === 404 || status === 503) {
    return "unavailable";
  }
  if (status === 429) {
    return "rate_limited";
  }
  return status >= 500 ? "server_error" : "failed";
};

/** The problem behind a Better Auth client error (or anything thrown). Pure. */
export const authProblemOf = (error: unknown): AuthProblem => {
  // What `fetch` rejects with when no response came back at all.
  if (error instanceof TypeError) {
    return "unreachable";
  }
  const parsed = errorSchema.safeParse(error);
  if (!parsed.success) {
    return "failed";
  }
  const code = parsed.data.code?.toUpperCase() ?? "";
  const refusal = signUpRefusalSchema.safeParse(code.toLowerCase());
  if (refusal.success) {
    return refusal.data;
  }
  return BY_CODE[code] ?? byStatus(parsed.data.status);
};

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
  "unavailable",
  "failed",
]);
export type AuthProblem = z.infer<typeof authProblemSchema>;

const errorSchema = z.object({
  code: z.string().optional(),
  status: z.number().optional(),
});

const BY_CODE: Readonly<Record<string, AuthProblem>> = {
  INVALID_EMAIL_OR_PASSWORD: "wrong_credentials",
  PASSWORD_TOO_SHORT: "weak_password",
  USER_ALREADY_EXISTS: "email_taken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "email_taken",
};

/** The problem behind a Better Auth client error (or anything thrown). Pure. */
export const authProblemOf = (error: unknown): AuthProblem => {
  const parsed = errorSchema.safeParse(error);
  if (!parsed.success) {
    return "failed";
  }
  const code = parsed.data.code?.toUpperCase() ?? "";
  const refusal = signUpRefusalSchema.safeParse(code.toLowerCase());
  if (refusal.success) {
    return refusal.data;
  }
  const known = BY_CODE[code];
  if (known) {
    return known;
  }
  // 404/503: no auth handler behind `/api/auth` (no database or no secret).
  return parsed.data.status === 404 || parsed.data.status === 503
    ? "unavailable"
    : "failed";
};

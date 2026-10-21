import {
  MICROSOFT_PROVIDER_ID,
  microsoftSsoOf,
  microsoftTenantPinned,
} from "@workspace/config/microsoft";
import type { AppConfig } from "@workspace/config/schema";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// Who may create an account (D22). Pure: the caller gathers the facts (is
// this the first user, is there an invitation for the address) and Better
// Auth's `user.validateUserInfo` gate asks this before any user row exists,
// for every sign-up method (email, GitHub/Google, OIDC).

export const signUpRefusalSchema = z.enum([
  /** `signup: invite` (the default): only invited addresses may join. */
  "invite_required",
  /** `signup: domain`: the address isn't in `auth.domains` and wasn't invited. */
  "domain_not_allowed",
  /** `signup: sso`: accounts come only from the configured OIDC providers. */
  "sso_required",
]);
export type SignUpRefusal = z.infer<typeof signUpRefusalSchema>;

export const signUpRequestSchema = z.object({
  email: z.string(),
  /** The provider vouched for the address (Better Auth's `emailVerified`). */
  emailVerified: z.boolean().optional(),
  /** Better Auth's provisioning method: `email-password`, `oauth`, `admin`, … */
  method: z.string(),
  /** The OAuth/OIDC provider id when `method` is `oauth`. */
  providerId: z.string().optional(),
});
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const signUpFactsSchema = z.object({
  /** A pending, unexpired invitation to any org exists for this address. */
  hasPendingInvitation: z.boolean(),
  /** No user exists yet: this one becomes the instance admin. */
  isFirstUser: z.boolean(),
});
export type SignUpFacts = z.infer<typeof signUpFactsSchema>;

/** The part after the last `@`, lowercased; `""` for something that isn't an address. */
export const emailDomain = (email: string): string => {
  const at = email.lastIndexOf("@");
  return at === -1
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
};

/**
 * What a Microsoft sign-up's tenant vouches for (186); `undefined` for any
 * other sign-up. Its tenant and domain allow-lists are checked before this.
 */
const microsoftSignUp = (auth: AppConfig["auth"], request: SignUpRequest) => {
  const microsoft =
    request.method === "oauth" && request.providerId === MICROSOFT_PROVIDER_ID
      ? microsoftSsoOf(auth)
      : undefined;
  if (!microsoft) {
    return;
  }
  const pinned = microsoftTenantPinned(microsoft);
  return {
    // The config only allows it on a pinned tenant.
    autoProvision: microsoft.autoProvision,
    // Any tenant's admin can give their users any email (nOAuth), so the
    // address is theirs only from a pinned tenant or a verified claim.
    ownsAddress: pinned || request.emailVerified === true,
    pinned,
  };
};

export const decideSignUp = (
  auth: AppConfig["auth"],
  request: SignUpRequest,
  facts: SignUpFacts
): Result<void, SignUpRefusal> => {
  // An instance admin creating a user from the admin UI is the policy.
  if (request.method === "admin") {
    return ok(undefined);
  }
  const microsoft = microsoftSignUp(auth, request);
  if (auth.signup === "sso") {
    // Even the first user: an SSO-only instance shouldn't be claimable with
    // a password by whoever finds it first.
    const fromOidc =
      request.method === "oauth" &&
      auth.oidc.some((provider) => provider.id === request.providerId);
    return fromOidc || microsoft?.pinned ? ok(undefined) : err("sso_required");
  }
  if (microsoft?.autoProvision) {
    return ok(undefined);
  }
  if (facts.isFirstUser) {
    return ok(undefined);
  }
  const ownsAddress = microsoft?.ownsAddress ?? true;
  const invited = ownsAddress && facts.hasPendingInvitation;
  switch (auth.signup) {
    case "open":
      return ok(undefined);
    case "invite":
      return invited ? ok(undefined) : err("invite_required");
    case "domain": {
      if (ownsAddress && auth.domains.includes(emailDomain(request.email))) {
        return ok(undefined);
      }
      return auth.invites && invited
        ? ok(undefined)
        : err("domain_not_allowed");
    }
    default: {
      const exhaustive: never = auth.signup;
      return exhaustive;
    }
  }
};

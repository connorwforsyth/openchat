import { appConfigSchema } from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import { decideSignUp, emailDomain, type SignUpRequest } from "./signup";

const authConfig = (auth: Record<string, unknown>) =>
  appConfigSchema.parse({ auth }).auth;

const oidc = [
  {
    clientId: "id",
    clientSecret: "secret",
    id: "corp",
    issuer: "https://idp.example.test",
    name: "Corp",
  },
];

const password = (email: string): SignUpRequest => ({
  email,
  method: "email-password",
});

describe("decideSignUp", () => {
  it.each<{
    auth: Record<string, unknown>;
    expected: string;
    first?: boolean;
    invited?: boolean;
    name: string;
    request: SignUpRequest;
  }>([
    {
      auth: {},
      expected: "ok",
      first: true,
      name: "the first user always gets in (invite, the default)",
      request: password("a@x.test"),
    },
    {
      auth: {},
      expected: "invite_required",
      name: "after that, invite-only",
      request: password("b@x.test"),
    },
    {
      auth: {},
      expected: "ok",
      invited: true,
      name: "an invited address gets in",
      request: password("b@x.test"),
    },
    {
      auth: {},
      expected: "invite_required",
      name: "the gate covers social sign-up too",
      request: { email: "b@x.test", method: "oauth", providerId: "github" },
    },
    {
      auth: { signup: "open" },
      expected: "ok",
      name: "open: anyone",
      request: password("c@x.test"),
    },
    {
      auth: { domains: ["corp.example"], signup: "domain" },
      expected: "ok",
      name: "domain: an allowed domain, any case",
      request: password("Dev@Corp.Example"),
    },
    {
      auth: { domains: ["corp.example"], signup: "domain" },
      expected: "domain_not_allowed",
      name: "domain: a subdomain isn't the domain",
      request: password("dev@eu.corp.example"),
    },
    {
      auth: { domains: ["corp.example"], signup: "domain" },
      expected: "ok",
      invited: true,
      name: "domain: invites still work by default",
      request: password("guest@else.example"),
    },
    {
      auth: { domains: ["corp.example"], invites: false, signup: "domain" },
      expected: "domain_not_allowed",
      invited: true,
      name: "domain: unless invites are off",
      request: password("guest@else.example"),
    },
    {
      auth: { oidc, signup: "sso" },
      expected: "ok",
      name: "sso: from a configured OIDC provider",
      request: { email: "a@x.test", method: "oauth", providerId: "corp" },
    },
    {
      auth: { oidc, signup: "sso" },
      expected: "sso_required",
      first: true,
      name: "sso: not even the first user with a password",
      request: password("a@x.test"),
    },
    {
      auth: { oidc, signup: "sso" },
      expected: "sso_required",
      name: "sso: GitHub isn't the SSO provider",
      request: { email: "a@x.test", method: "oauth", providerId: "github" },
    },
    {
      auth: {},
      expected: "ok",
      name: "an instance admin creating a user is always allowed",
      request: { email: "new@x.test", method: "admin" },
    },
  ])("$name", ({ auth, expected, first = false, invited = false, request }) => {
    const result = decideSignUp(authConfig(auth), request, {
      hasPendingInvitation: invited,
      isFirstUser: first,
    });
    expect(result.ok ? "ok" : result.error).toBe(expected);
  });
});

describe("emailDomain", () => {
  it.each([
    ["a@Example.COM", "example.com"],
    ["odd@name@corp.example", "corp.example"],
    ["no-at-sign", ""],
  ])("%s -> %s", (email, domain) => {
    expect(emailDomain(email)).toBe(domain);
  });
});

describe("decideSignUp with Microsoft (186)", () => {
  const TENANT = "4f1c9a7e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
  const microsoft = { clientId: "id", clientSecret: "secret" };
  const pinned = { ...microsoft, tenantId: TENANT };
  const viaMicrosoft: SignUpRequest = {
    email: "ada@contoso.com",
    method: "oauth",
    providerId: "microsoft",
  };
  const facts = { hasPendingInvitation: false, isFirstUser: false };
  const invited = { hasPendingInvitation: true, isFirstUser: false };

  it("counts as SSO for `signup: sso` from a pinned tenant only", () => {
    expect(
      decideSignUp(
        authConfig({ microsoft: pinned, signup: "sso" }),
        viaMicrosoft,
        facts
      ).ok
    ).toBe(true);
    expect(
      decideSignUp(
        authConfig({ microsoft, oidc, signup: "sso" }),
        viaMicrosoft,
        facts
      )
    ).toEqual({ error: "sso_required", ok: false });
  });

  it("passes `signup: invite` only with `autoProvision`", () => {
    expect(
      decideSignUp(authConfig({ microsoft }), viaMicrosoft, facts)
    ).toEqual({ error: "invite_required", ok: false });
    expect(
      decideSignUp(
        authConfig({
          microsoft: {
            ...microsoft,
            allowedTenants: [TENANT],
            autoProvision: true,
          },
        }),
        viaMicrosoft,
        facts
      ).ok
    ).toBe(true);
  });

  // Any tenant's admin can set any email on their own users (nOAuth), so
  // the address only counts from a pinned tenant or a verified-email claim.
  it.each<{
    auth: Record<string, unknown>;
    emailVerified?: boolean;
    expected: string;
    name: string;
  }>([
    {
      auth: { microsoft },
      expected: "invite_required",
      name: "an invitation from any tenant with an unverified email",
    },
    {
      auth: { microsoft },
      emailVerified: true,
      expected: "ok",
      name: "an invitation with a verified email",
    },
    {
      auth: { microsoft: pinned },
      expected: "ok",
      name: "an invitation from the pinned tenant",
    },
    {
      auth: { microsoft: { ...microsoft, allowedTenants: [TENANT] } },
      expected: "ok",
      name: "an invitation from an allowed tenant",
    },
    {
      auth: { domains: ["contoso.com"], microsoft, signup: "domain" },
      expected: "domain_not_allowed",
      name: "`signup: domain` from any tenant with an unverified email",
    },
    {
      auth: { domains: ["contoso.com"], microsoft: pinned, signup: "domain" },
      expected: "ok",
      name: "`signup: domain` from the pinned tenant",
    },
  ])("$name: $expected", ({ auth, emailVerified, expected }) => {
    const decision = decideSignUp(
      authConfig(auth),
      { ...viaMicrosoft, emailVerified },
      invited
    );
    expect(decision.ok ? "ok" : decision.error).toBe(expected);
  });

  it("does nothing once switched off", () => {
    expect(
      decideSignUp(
        authConfig({
          microsoft: { ...microsoft, enabled: false },
          signup: "open",
        }),
        viaMicrosoft,
        facts
      ).ok
    ).toBe(true);
    expect(
      appConfigSchema.safeParse({
        auth: { microsoft: { ...microsoft, enabled: false }, signup: "sso" },
      }).success
    ).toBe(false);
  });
});

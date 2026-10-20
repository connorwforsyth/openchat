// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests exercise `${ENV}` interpolation in YAML text.
import { describe, expect, it } from "vitest";

import { parseConfig } from "./parse";
import { toPublicConfig } from "./public";
import { appConfigSchema } from "./schema";

const TENANT = "4f1c9a7e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

const withMicrosoft = (microsoft: unknown) =>
  appConfigSchema.safeParse({ auth: { microsoft } });

describe("auth.microsoft (186)", () => {
  it("is off without a block, and the app config is otherwise unchanged", () => {
    const parsed = appConfigSchema.parse({});
    expect(parsed.auth.microsoft).toBeUndefined();
    expect(toPublicConfig(parsed).auth.providers).toEqual([]);
  });

  it("is off when the credentials interpolate to nothing (an empty .env)", () => {
    const yaml = [
      "auth:",
      "  microsoft:",
      "    clientId: ${MICROSOFT_CLIENT_ID}",
      "    clientSecret: ${MICROSOFT_CLIENT_SECRET}",
      "    tenantId: organizations",
    ].join("\n");
    const result = parseConfig(yaml, {});
    expect(result.ok && result.value.auth.microsoft).toBeUndefined();
  });

  it("fills in defaults for a minimal block", () => {
    const result = withMicrosoft({ clientId: "id", clientSecret: "secret" });
    expect(result.success && result.data.auth.microsoft).toEqual({
      allowedDomains: [],
      allowedTenants: [],
      autoProvision: false,
      clientId: "id",
      clientSecret: "secret",
      enabled: true,
      name: "Microsoft",
      photo: { enabled: true, maxBytes: 1_048_576 },
      tenantId: "common",
    });
  });

  it("takes a specific tenant, lowercases domains, and lists the button", () => {
    const result = withMicrosoft({
      allowedDomains: ["Contoso.com"],
      allowedTenants: [TENANT],
      clientId: "id",
      clientSecret: "secret",
      name: "Contoso",
      tenantId: TENANT,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.auth.microsoft?.allowedDomains).toEqual(["contoso.com"]);
    expect(toPublicConfig(result.data).auth.providers).toEqual([
      { id: "microsoft", name: "Contoso" },
    ]);
  });

  it("hides the button when `enabled: false`", () => {
    const result = withMicrosoft({
      clientId: "id",
      clientSecret: "secret",
      enabled: false,
    });
    expect(
      result.success && toPublicConfig(result.data).auth.providers
    ).toEqual([]);
  });

  it.each([
    ["an unknown tenant keyword", { tenantId: "everyone" }],
    ["a typo'd key", { clientID: "x" }],
    ["a bad domain", { allowedDomains: ["not a domain"] }],
    ["a tenant allow-list entry that isn't a GUID", { allowedTenants: ["x"] }],
    ["an absurd photo cap", { photo: { maxBytes: 100_000_000 } }],
    // Anyone with a Microsoft account could create one.
    ["open auto-provisioning on `common`", { autoProvision: true }],
  ])("rejects %s", (_label, extra) => {
    expect(
      withMicrosoft({ clientId: "id", clientSecret: "secret", ...extra })
        .success
    ).toBe(false);
  });

  it("allows auto-provisioning once the tenant is pinned", () => {
    for (const pinned of [
      { tenantId: TENANT },
      { tenantId: "contoso.onmicrosoft.com" },
      { allowedTenants: [TENANT] },
    ]) {
      expect(
        withMicrosoft({
          autoProvision: true,
          clientId: "id",
          clientSecret: "secret",
          ...pinned,
        }).success
      ).toBe(true);
    }
  });

  // Any tenant's admin can give a user any email address (nOAuth), so a
  // domain list filters who signs in but can't vouch for anyone.
  it.each(["common", "organizations"])(
    "refuses auto-provisioning on `%s` narrowed only by `allowedDomains`",
    (tenantId) => {
      const result = withMicrosoft({
        allowedDomains: ["contoso.com"],
        autoProvision: true,
        clientId: "id",
        clientSecret: "secret",
        tenantId,
      });
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([
        ["auth", "microsoft", "autoProvision"],
      ]);
    }
  );

  it("satisfies `signup: sso` once its tenant is pinned", () => {
    const sso = (microsoft: Record<string, unknown>) =>
      appConfigSchema.safeParse({
        auth: {
          microsoft: { clientId: "id", clientSecret: "secret", ...microsoft },
          signup: "sso",
        },
      }).success;
    expect(sso({ tenantId: TENANT })).toBe(true);
    expect(sso({ allowedTenants: [TENANT] })).toBe(true);
    // Otherwise every Microsoft account in the world could make one.
    expect(sso({})).toBe(false);
    expect(sso({ allowedDomains: ["contoso.com"] })).toBe(false);
  });
});

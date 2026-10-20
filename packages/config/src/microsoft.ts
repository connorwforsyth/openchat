import { z } from "zod";

// Sign in with Microsoft (Entra ID, ticket 186): `auth.microsoft` in
// app.config.yaml. Credentials come from `${ENV}`, so with them unset the
// block interpolates to a provider left off, never a boot failure. The auth
// server registers Better Auth's built-in `microsoft` provider from this, and
// the public config lists its button; both read `microsoftSsoOf`.

export const MICROSOFT_PROVIDER_ID = "microsoft";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** Entra's multi-tenant keywords, or one tenant by GUID or primary domain. */
const tenantIdSchema = z.union([
  z.enum(["common", "organizations", "consumers"]),
  z.string().regex(GUID, "a tenant GUID"),
  z
    .string()
    .toLowerCase()
    .regex(DOMAIN, "a tenant domain, like `contoso.onmicrosoft.com`"),
]);

const MULTI_TENANT: ReadonlySet<string> = new Set([
  "common",
  "organizations",
  "consumers",
]);

const strictMicrosoftSchema = z
  .strictObject({
    /** Email domains that may sign in (`[contoso.com]`); empty allows any. */
    allowedDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(DOMAIN, "a domain, like `contoso.com`")
      )
      .default([]),
    /** Entra tenant GUIDs (the `tid` claim) that may sign in; empty allows any. */
    allowedTenants: z
      .array(z.string().toLowerCase().regex(GUID, "a tenant GUID"))
      .default([]),
    /**
     * Create accounts for allowed Microsoft users even when `signup` is
     * `invite` or `domain`. Off, Microsoft sign-ups follow `signup`.
     */
    autoProvision: z.boolean().default(false),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    enabled: z.boolean().default(true),
    /** The button reads "Continue with <name>". */
    name: z.string().trim().min(1).max(60).default("Microsoft"),
    /** The Graph profile photo, copied into storage on each sign-in. */
    photo: z
      .strictObject({
        enabled: z.boolean().default(true),
        /** Larger photos are skipped. Entra's originals can be several MB. */
        maxBytes: z
          .int()
          .min(1024)
          .max(5 * 1024 * 1024)
          .default(1024 * 1024),
      })
      .prefault({}),
    tenantId: tenantIdSchema.default("common"),
  })
  .superRefine((microsoft, context) => {
    const narrowed =
      !MULTI_TENANT.has(microsoft.tenantId) ||
      microsoft.allowedDomains.length > 0 ||
      microsoft.allowedTenants.length > 0;
    if (microsoft.autoProvision && !narrowed) {
      context.addIssue({
        code: "custom",
        message:
          "`autoProvision` needs a specific `tenantId`, `allowedDomains` or `allowedTenants`; otherwise any Microsoft account could create one",
        path: ["autoProvision"],
      });
    }
  });

/**
 * `clientId: ${MICROSOFT_CLIENT_ID}` with the variable unset interpolates to
 * a missing key. Without both credentials the block is a provider left off,
 * like `auth.social`; any other mistake still fails.
 */
const withoutMissingCredentials = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return "clientId" in value && "clientSecret" in value ? value : undefined;
};

export const microsoftSsoSchema = z.preprocess(
  withoutMissingCredentials,
  strictMicrosoftSchema.optional()
);
export type MicrosoftSsoConfig = z.infer<typeof strictMicrosoftSchema>;

/** The Microsoft block when it's configured and switched on. */
export const microsoftSsoOf = (auth: {
  readonly microsoft?: MicrosoftSsoConfig;
}): MicrosoftSsoConfig | undefined =>
  auth.microsoft?.enabled ? auth.microsoft : undefined;

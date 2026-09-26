import { z } from "zod";

import { orgIdSchema, teamIdSchema, userIdSchema } from "./common";
import { runTargetSchema } from "./runs";
import { sandboxProviderSchema } from "./sandbox";
import {
  chatContextSchema,
  chatContextTypeSchema,
  orgSchema,
  teamRoleSchema,
  teamSchema,
} from "./tenancy";

// Who the caller is, and the slice of instance config a client may see. The
// brand is read from here at runtime (D18): no client hard-codes the name.

export const meSchema = z.object({
  orgs: z.array(orgSchema),
  personalOrgId: orgIdSchema,
  teams: z.array(z.object({ role: teamRoleSchema, team: teamSchema })),
  user: z.object({
    email: z.email(),
    id: userIdSchema,
    image: z.url().nullable(),
    /** Instance admin (the first user, D22). */
    isAdmin: z.boolean(),
    /** Saved UI locale; `null` means negotiate from the browser. */
    locale: z.string().max(35).nullable(),
    name: z.string(),
  }),
});
export type Me = z.infer<typeof meSchema>;

export const userSettingsSchema = z.object({
  defaultContext: chatContextSchema,
  defaultTarget: runTargetSchema.nullable(),
  locale: z.string().max(35).nullable(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const updateUserSettingsInputSchema = userSettingsSchema.partial();

export const signupModeSchema = z.enum(["open", "invite", "domain", "sso"]);
export type SignupMode = z.infer<typeof signupModeSchema>;

/** Feature switches from app.config.yaml `features`. */
export const featureFlagSchema = z.enum([
  "importers",
  "publicLinks",
  "sandboxes",
  "webSearch",
  "memory",
  "fileUploads",
]);
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/** Instance config safe for anyone to read, signed in or not. No secrets, no URLs of internal services. */
export const publicConfigSchema = z.object({
  auth: z.object({
    /** OIDC and social providers offered on the sign-in page. */
    providers: z.array(z.object({ id: z.string(), name: z.string() })),
    signup: signupModeSchema,
  }),
  brand: z.object({
    faviconUrl: z.string().nullable(),
    logoUrl: z.string().nullable(),
    name: z.string().min(1),
  }),
  features: z.record(featureFlagSchema, z.boolean()),
  limits: z.object({
    memoryMaxChars: z.int().min(1),
    uploadMaxMb: z.number().positive(),
  }),
  policies: z.object({
    chatContexts: z.array(chatContextTypeSchema).min(1),
  }),
  sandbox: z.object({
    default: sandboxProviderSchema.nullable(),
    providers: z.array(sandboxProviderSchema),
  }),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

/** The picker's models depend on the context, because keys do (D17). Flat for the query string. */
export const listModelsInputSchema = z.object({
  contextId: z.union([teamIdSchema, orgIdSchema]).optional(),
  contextType: chatContextTypeSchema.default("personal"),
});

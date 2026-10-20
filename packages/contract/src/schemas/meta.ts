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
  /**
   * Whether this user's clients may keep the query cache on disk (D28):
   * `false` when the instance or any org they belong to turns it off.
   */
  persistClientCache: z.boolean(),
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

/**
 * A user's recorded shortcuts (Q31, D10): shortcut id to key combos. A
 * missing id means the default, `[]` means off. Ids and combos are checked
 * by `@workspace/shortcuts`, which drops entries it doesn't know, so the
 * contract only bounds them.
 */
export const shortcutOverridesSchema = z
  .record(z.string().min(1).max(64), z.array(z.string().min(1).max(64)).max(3))
  .refine((overrides) => Object.keys(overrides).length <= 200, {
    message: "at most 200 shortcuts",
  });
export type ShortcutOverridesSetting = z.infer<typeof shortcutOverridesSchema>;

/**
 * How the sidebar is laid out on a wide screen (181): the icon rail beside a
 * collapsible chat panel, or the classic single sidebar.
 */
export const sidebarLayoutSchema = z.enum(["rail", "classic"]);
export type SidebarLayoutSetting = z.infer<typeof sidebarLayoutSchema>;

export const userSettingsSchema = z.object({
  defaultContext: chatContextSchema,
  defaultTarget: runTargetSchema.nullable(),
  locale: z.string().max(35).nullable(),
  /** `{}` when nothing is recorded. Replaced whole on update. */
  shortcuts: shortcutOverridesSchema,
  /** Missing means never chosen: show the rail. */
  sidebarLayout: sidebarLayoutSchema.optional(),
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
  artifacts: z.object({
    /**
     * The public origins a Site artifact may load fonts, styles, scripts and
     * images from (125); its CSP blocks everything else. The artifact
     * runtime reads it to build that CSP.
     */
    siteOrigins: z.array(z.string()),
  }),
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

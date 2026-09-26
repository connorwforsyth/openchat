import { z } from "zod";

import {
  orgIdSchema,
  providerKeyIdSchema,
  teamIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { providerIdSchema } from "./models";

// Provider keys (D3, D17, D24). Instance keys come from app.config.yaml; org,
// team and user keys are stored encrypted (AES-GCM, rotatable key id). The API
// never returns a key: only a label and a short hint. `resolveChatKeys` picks
// which one pays for a run from the chat context.

export const keyScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("instance") }),
  z.object({ id: orgIdSchema, type: z.literal("org") }),
  z.object({ id: teamIdSchema, type: z.literal("team") }),
  z.object({ id: userIdSchema, type: z.literal("user") }),
]);
export type KeyScope = z.infer<typeof keyScopeSchema>;

/** Scopes a key can be added to through the API; instance keys live in the YAML. */
export const writableKeyScopeSchema = z.discriminatedUnion("type", [
  keyScopeSchema.options[1],
  keyScopeSchema.options[2],
  keyScopeSchema.options[3],
]);

export const providerKeySchema = z.object({
  baseURL: z.url().nullable(),
  createdAt: timestampSchema,
  /** `null` for keys from app.config.yaml. */
  createdBy: userIdSchema.nullable(),
  /** The last four characters, for recognising a key. */
  hint: z.string().max(8),
  id: providerKeyIdSchema,
  label: z.string().max(100),
  lastUsedAt: timestampSchema.nullable(),
  provider: providerIdSchema,
  scope: keyScopeSchema,
  source: z.enum(["config", "database"]),
});
export type ProviderKey = z.infer<typeof providerKeySchema>;

export const createProviderKeyInputSchema = z.object({
  /** Write-only. Encrypted before it's stored; never echoed, logged or returned. */
  apiKey: z
    .string()
    .min(8)
    .max(8192)
    .describe("Write-only secret; never returned."),
  baseURL: z.url().optional(),
  label: z.string().trim().max(100).default(""),
  provider: providerIdSchema,
  scope: writableKeyScopeSchema,
});

export const listProviderKeysInputSchema = z.object({
  scopeId: z.union([orgIdSchema, teamIdSchema, userIdSchema]).optional(),
  scopeType: z.enum(["instance", "org", "team", "user"]).optional(),
});

/** A cheap live check against the provider. Failure is data, not an error. */
export const verifyProviderKeyOutputSchema = z.object({
  message: z.string().nullable(),
  ok: z.boolean(),
});

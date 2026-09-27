import { z } from "zod";

import {
  invitationIdSchema,
  nameSchema,
  orgIdSchema,
  teamIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";

// Tenancy (PLAN.md D17): every user has a hidden personal org; anyone can
// create more orgs; teams form a tree inside an org (`parentId`). Access
// granted to a team flows down to its descendants; usage rolls up.

/** Better Auth's organization-plugin roles. */
export const orgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/** Team roles are ours (Better Auth teams are flat). Admins manage the team and its sub-teams. */
export const teamRoleSchema = z.enum(["admin", "member"]);
export type TeamRole = z.infer<typeof teamRoleSchema>;

/** Another user, as other people see them. Email is only shown within a shared org. */
export const userSummarySchema = z.object({
  email: z.email().nullable(),
  id: userIdSchema,
  image: z.url().nullable(),
  name: z.string(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and dashes");

export const orgSchema = z.object({
  createdAt: timestampSchema,
  id: orgIdSchema,
  /** The hidden per-user org behind the Personal context; never listed as an org in the UI. */
  isPersonal: z.boolean(),
  logoUrl: z.url().nullable(),
  /** The caller's role in this org. */
  myRole: orgRoleSchema,
  name: nameSchema,
  slug: slugSchema,
});
export type Org = z.infer<typeof orgSchema>;

export const orgMemberSchema = z.object({
  joinedAt: timestampSchema,
  orgId: orgIdSchema,
  role: orgRoleSchema,
  /** Teams in this org the member belongs to directly (not via ancestors). */
  teamIds: z.array(teamIdSchema),
  user: userSummarySchema,
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

export const invitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "canceled",
  "expired",
]);

/**
 * The secret an invitee accepts with (Q16): 32 random bytes, base64url. The
 * server keeps only a hash, so it's shown once, in `invite`'s response, and
 * travels in the invite link; the invitation id is not enough to accept.
 */
export const invitationTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "base64url");

export const invitationSchema = z.object({
  createdAt: timestampSchema,
  email: z.email(),
  expiresAt: timestampSchema,
  id: invitationIdSchema,
  invitedBy: userIdSchema,
  orgId: orgIdSchema,
  role: orgRoleSchema,
  status: invitationStatusSchema,
  /** Teams the invitee joins on accepting. */
  teamIds: z.array(teamIdSchema),
  /** Only in `invite`'s response: it's stored hashed, so it can't be listed or shown again. */
  token: invitationTokenSchema.optional(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** A node of the team tree. The tree is returned flat; clients nest by `parentId`. */
export const teamSchema = z.object({
  createdAt: timestampSchema,
  id: teamIdSchema,
  name: nameSchema,
  orgId: orgIdSchema,
  /** `null` for a top-level team. */
  parentId: teamIdSchema.nullable(),
});
export type Team = z.infer<typeof teamSchema>;

export const teamMemberSchema = z.object({
  addedAt: timestampSchema,
  role: teamRoleSchema,
  teamId: teamIdSchema,
  user: userSummarySchema,
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/**
 * Who a grant, budget or key belongs to. `resource_grant.principalType` and
 * `principalId`, as one value.
 */
export const principalSchema = z.discriminatedUnion("type", [
  z.object({ id: userIdSchema, type: z.literal("user") }),
  z.object({ id: teamIdSchema, type: z.literal("team") }),
  z.object({ id: orgIdSchema, type: z.literal("org") }),
]);
export type Principal = z.infer<typeof principalSchema>;

export const chatContextTypeSchema = z.enum(["personal", "team", "org"]);
export type ChatContextType = z.infer<typeof chatContextTypeSchema>;

/**
 * Whose keys pay, where usage rolls up and whether the org audit policy
 * applies (D17). Personal maps to the caller's personal org on the server.
 * Changeable until the conversation's first message, then locked.
 */
export const chatContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("personal") }),
  z.object({ id: teamIdSchema, type: z.literal("team") }),
  z.object({ id: orgIdSchema, type: z.literal("org") }),
]);
export type ChatContext = z.infer<typeof chatContextSchema>;

export const publishGateSchema = z.enum(["informational", "no-regressions"]);
export type PublishGate = z.infer<typeof publishGateSchema>;

const allowance = z.enum(["allowed", "forbidden"]);

/**
 * Instance-wide limits on org policy, from app.config.yaml `policies` (D18).
 * Orgs choose within them. Defined here so the admin UI can show them; the
 * config package parses the YAML with this same schema.
 */
export const instancePolicySchema = z.object({
  /** Whether org owners may switch on the audit policy at all. */
  auditPolicy: allowance.default("allowed"),
  /** Chat contexts allowed anywhere on the instance; `[personal]` means always personal. */
  chatContext: z
    .array(chatContextTypeSchema)
    .min(1)
    .default(["personal", "team", "org"]),
  /** Whether instance keys pay, per context type, when the context has none (D17). */
  instanceKeys: z
    .object({
      org: z.boolean().default(false),
      personal: z.boolean().default(true),
      team: z.boolean().default(false),
    })
    .prefault({}),
  /** Whether clients may keep the query cache on disk (D28); `forbidden` turns it off everywhere. */
  persistClientCache: allowance.default("allowed"),
  personalKeyFallback: allowance.default("allowed"),
  publishGate: z
    .object({
      allowed: z
        .array(publishGateSchema)
        .min(1)
        .default(["informational", "no-regressions"]),
      default: publishGateSchema.default("informational"),
    })
    .prefault({}),
  sampledScoring: allowance.default("allowed"),
});
export type InstancePolicy = z.infer<typeof instancePolicySchema>;

/**
 * An org's own policy choices, stored in `org_settings`. Each must sit within
 * the instance limits in `app.config.yaml` `policies`; `clampOrgPolicy` in
 * `@workspace/config/policy` enforces that. Defaults are the conservative ones.
 */
export const orgPolicySchema = z.object({
  /** Admins may read private chat content in this org's contexts; members are told. */
  auditEnabled: z.boolean().default(false),
  /** Chat contexts members may pick when this org is involved. */
  chatContexts: z
    .array(chatContextTypeSchema)
    .min(1)
    .default(["personal", "team", "org"]),
  /**
   * Clients may keep the query cache on disk for an instant boot (D28). Off
   * for shared machines: a member of any org that turns it off gets no
   * persisted cache (`Me.persistClientCache`).
   */
  persistClientCache: z.boolean().default(true),
  /** Fall back to a member's personal keys when the context has none. */
  personalKeyFallback: z.boolean().default(false),
  /** Default publish-gate policy for this org's libraries. */
  publishGate: publishGateSchema.default("informational"),
  /** Sampled production scoring (Agents+ wave) runs in this org's contexts. */
  sampledScoring: z.boolean().default(false),
});
export type OrgPolicy = z.infer<typeof orgPolicySchema>;

/** A field `clampOrgPolicy` changed to fit the instance limits, and why. */
export const policyAdjustmentSchema = z.object({
  field: z.enum([
    "auditEnabled",
    "chatContexts",
    "persistClientCache",
    "personalKeyFallback",
    "publishGate",
    "sampledScoring",
  ]),
  reason: z.enum(["forbidden_by_instance", "not_allowed_by_instance"]),
});
export type PolicyAdjustment = z.infer<typeof policyAdjustmentSchema>;

/** What the org admin page shows: the stored choice, what applies, and the limits. */
export const orgPolicyViewSchema = z.object({
  adjustments: z.array(policyAdjustmentSchema),
  effective: orgPolicySchema,
  limits: instancePolicySchema,
  stored: orgPolicySchema,
});
export type OrgPolicyView = z.infer<typeof orgPolicyViewSchema>;

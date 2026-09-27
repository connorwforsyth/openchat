import { z } from "zod";

import { conflictError } from "../errors";
import {
  invitationIdSchema,
  nameSchema,
  orgIdSchema,
  pageInputSchema,
  pageOf,
  teamIdSchema,
  userIdSchema,
} from "../schemas/common";
import {
  invitationSchema,
  invitationTokenSchema,
  orgMemberSchema,
  orgPolicySchema,
  orgPolicyViewSchema,
  orgRoleSchema,
  orgSchema,
  slugSchema,
  teamMemberSchema,
  teamRoleSchema,
  teamSchema,
} from "../schemas/tenancy";
import { authed } from "./base";

// Orgs and invitations are Better Auth's organization plugin underneath;
// these procedures wrap it so every client (and OpenAPI) sees one surface.

const byOrg = z.object({ id: orgIdSchema });

export const orgs = {
  acceptInvitation: authed
    .route({
      description:
        "Accepts with the invite link's `token` (Q16). The signed-in user's email must match the invitation's. `{ id }` still works for one release and is deprecated: an id is visible to org admins, a token only to the invitee. An unknown, used or expired token is `NOT_FOUND`.",
      method: "POST",
      path: "/invitations/accept",
      summary: "Accept an invitation",
    })
    .input(
      z.union([
        z.object({ token: invitationTokenSchema }),
        z
          .object({ id: invitationIdSchema })
          .meta({ deprecated: true, description: "Deprecated: use `token`." }),
      ])
    )
    .output(orgSchema),
  cancelInvitation: authed
    .route({
      method: "DELETE",
      path: "/orgs/{orgId}/invitations/{id}",
      successStatus: 204,
      summary: "Cancel an invitation",
    })
    .input(z.object({ id: invitationIdSchema, orgId: orgIdSchema }))
    .output(z.void()),
  create: authed
    .errors(conflictError)
    .route({
      method: "POST",
      path: "/orgs",
      successStatus: 201,
      summary: "Create an org",
    })
    .input(z.object({ name: nameSchema, slug: slugSchema }))
    .output(orgSchema),
  delete: authed
    .route({
      method: "DELETE",
      path: "/orgs/{id}",
      successStatus: 204,
      summary: "Delete an org",
    })
    .input(byOrg)
    .output(z.void()),
  get: authed
    .route({ method: "GET", path: "/orgs/{id}", summary: "Get an org" })
    .input(byOrg)
    .output(orgSchema),
  getPolicy: authed
    .route({
      description:
        "The org's stored choices, the policy in effect after clamping to the instance limits, and those limits.",
      method: "GET",
      path: "/orgs/{id}/policy",
      summary: "Get org policy",
    })
    .input(byOrg)
    .output(orgPolicyViewSchema),
  invite: authed
    .errors(conflictError)
    .route({
      description:
        "The response carries the invitation's `token`, once: it's stored hashed. Build the invite link from it.",
      method: "POST",
      path: "/orgs/{orgId}/invitations",
      successStatus: 201,
      summary: "Invite a member",
    })
    .input(
      z.object({
        email: z.email(),
        orgId: orgIdSchema,
        role: orgRoleSchema.default("member"),
        teamIds: z.array(teamIdSchema).max(50).default([]),
      })
    )
    .output(invitationSchema),
  leave: authed
    .errors(conflictError)
    .route({
      description: "`CONFLICT` (`last_owner`) for the only owner.",
      method: "POST",
      path: "/orgs/{id}/leave",
      successStatus: 204,
      summary: "Leave an org",
    })
    .input(byOrg)
    .output(z.void()),
  list: authed
    .route({
      description: "Orgs the caller belongs to, without the personal one.",
      method: "GET",
      path: "/orgs",
      summary: "List my orgs",
    })
    .output(z.array(orgSchema)),
  listInvitations: authed
    .route({
      method: "GET",
      path: "/orgs/{orgId}/invitations",
      summary: "List invitations",
    })
    .input(z.object({ orgId: orgIdSchema }))
    .output(z.array(invitationSchema)),
  members: authed
    .route({
      method: "GET",
      path: "/orgs/{orgId}/members",
      summary: "List org members",
    })
    .input(
      pageInputSchema.extend({
        orgId: orgIdSchema,
        query: z.string().trim().max(200).optional(),
      })
    )
    .output(pageOf(orgMemberSchema)),
  removeMember: authed
    .errors(conflictError)
    .route({
      method: "DELETE",
      path: "/orgs/{orgId}/members/{userId}",
      successStatus: 204,
      summary: "Remove a member",
    })
    .input(z.object({ orgId: orgIdSchema, userId: userIdSchema }))
    .output(z.void()),
  update: authed
    .errors(conflictError)
    .route({ method: "PATCH", path: "/orgs/{id}", summary: "Update an org" })
    .input(
      z.object({
        id: orgIdSchema,
        logoUrl: z.url().nullable().optional(),
        name: nameSchema.optional(),
        slug: slugSchema.optional(),
      })
    )
    .output(orgSchema),
  updateMember: authed
    .errors(conflictError)
    .route({
      method: "PATCH",
      path: "/orgs/{orgId}/members/{userId}",
      summary: "Change a member's role",
    })
    .input(
      z.object({
        orgId: orgIdSchema,
        role: orgRoleSchema,
        userId: userIdSchema,
      })
    )
    .output(orgMemberSchema),
  updatePolicy: authed
    .route({
      description:
        "Stores the org's choices as given; the response says which were clamped to the instance limits.",
      method: "PUT",
      path: "/orgs/{id}/policy",
      summary: "Set org policy",
    })
    .input(z.object({ id: orgIdSchema, policy: orgPolicySchema }))
    .output(orgPolicyViewSchema),
};

export const teams = {
  addMember: authed
    .route({
      method: "PUT",
      path: "/teams/{teamId}/members/{userId}",
      summary: "Add or update a team member",
    })
    .input(
      z.object({
        role: teamRoleSchema.default("member"),
        teamId: teamIdSchema,
        userId: userIdSchema,
      })
    )
    .output(teamMemberSchema),
  create: authed
    .route({
      method: "POST",
      path: "/orgs/{orgId}/teams",
      successStatus: 201,
      summary: "Create a team",
    })
    .input(
      z.object({
        name: nameSchema,
        orgId: orgIdSchema,
        parentId: teamIdSchema.nullable().default(null),
      })
    )
    .output(teamSchema),
  delete: authed
    .errors(conflictError)
    .route({
      description: "`CONFLICT` (`not_empty`) while the team has sub-teams.",
      method: "DELETE",
      path: "/teams/{id}",
      successStatus: 204,
      summary: "Delete a team",
    })
    .input(z.object({ id: teamIdSchema }))
    .output(z.void()),
  list: authed
    .route({
      description: "The org's whole team tree, flat; nest by `parentId`.",
      method: "GET",
      path: "/orgs/{orgId}/teams",
      summary: "List the team tree",
    })
    .input(z.object({ orgId: orgIdSchema }))
    .output(z.array(teamSchema)),
  members: authed
    .route({
      method: "GET",
      path: "/teams/{id}/members",
      summary: "List team members",
    })
    .input(z.object({ id: teamIdSchema }))
    .output(z.array(teamMemberSchema)),
  removeMember: authed
    .route({
      method: "DELETE",
      path: "/teams/{teamId}/members/{userId}",
      successStatus: 204,
      summary: "Remove a team member",
    })
    .input(z.object({ teamId: teamIdSchema, userId: userIdSchema }))
    .output(z.void()),
  update: authed
    .errors(conflictError)
    .route({
      description:
        "Rename or move. Moving under one of its own descendants is `CONFLICT` (`team_cycle`).",
      method: "PATCH",
      path: "/teams/{id}",
      summary: "Rename or move a team",
    })
    .input(
      z.object({
        id: teamIdSchema,
        name: nameSchema.optional(),
        parentId: teamIdSchema.nullable().optional(),
      })
    )
    .output(teamSchema),
};

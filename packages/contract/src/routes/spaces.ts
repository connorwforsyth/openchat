import { z } from "zod";

import { conflictError } from "../errors";
import { nameSchema, userIdSchema } from "../schemas/common";
import {
  allowanceGrantSchema,
  keyUsageSchema,
  spaceAllowanceSchema,
  spaceContentItemSchema,
  spaceContentTypeSchema,
  spaceMemberSchema,
  spacePathSchema,
  spaceRoleSchema,
  spaceSchema,
} from "../schemas/spaces";
import { authed } from "./base";

// Spaces (ticket 187): orgs and the team tree, spoken of as one tree of
// spaces. Additive: `orgs` and `teams` are unchanged and keep working.

export const spaces = {
  allowance: authed
    .route({
      description:
        "The space's monthly token pool, this month's use and the members' grants. Members see only their own grant.",
      method: "GET",
      path: "/spaces/{type}/{id}/allowance",
      summary: "Get a space's allowance",
    })
    .input(spacePathSchema)
    .output(spaceAllowanceSchema),
  content: authed
    .route({
      description:
        "Chats, agents and skills shared to this space or to any space above it.",
      method: "GET",
      path: "/spaces/{type}/{id}/content",
      summary: "List a space's shared content",
    })
    .input(spacePathSchema)
    .output(z.array(spaceContentItemSchema)),
  createChild: authed
    .route({
      method: "POST",
      path: "/spaces/{type}/{id}/children",
      successStatus: 201,
      summary: "Create a sub-space",
    })
    .input(spacePathSchema.extend({ name: nameSchema }))
    .output(spaceSchema),
  decideAllowance: authed
    .route({
      description: "Owners approve (optionally changing the amount) or deny.",
      method: "PATCH",
      path: "/spaces/{type}/{id}/allowance/grants/{grantId}",
      summary: "Approve or deny an allowance request",
    })
    .input(
      spacePathSchema.extend({
        decision: z.enum(["approved", "denied"]),
        grantId: z.uuid(),
        monthlyTokens: z.int().min(1).optional(),
      })
    )
    .output(allowanceGrantSchema),
  get: authed
    .route({
      method: "GET",
      path: "/spaces/{type}/{id}",
      summary: "Get a space",
    })
    .input(spacePathSchema)
    .output(spaceSchema),
  keyUsage: authed
    .route({
      description:
        "Token use and cost this month against each key stored in the space, for its owners and admins.",
      method: "GET",
      path: "/spaces/{type}/{id}/keys/usage",
      summary: "Usage per key",
    })
    .input(spacePathSchema)
    .output(keyUsageSchema),
  list: authed
    .route({
      description:
        "Every space the caller can see, flat, the personal space first; nest by `parent`.",
      method: "GET",
      path: "/spaces",
      summary: "List my spaces",
    })
    .output(z.array(spaceSchema)),
  members: authed
    .route({
      method: "GET",
      path: "/spaces/{type}/{id}/members",
      summary: "List a space's members",
    })
    .input(spacePathSchema)
    .output(z.array(spaceMemberSchema)),
  removeMember: authed
    .errors(conflictError)
    .route({
      description: "`CONFLICT` (`last_owner`) for a root space's only owner.",
      method: "DELETE",
      path: "/spaces/{type}/{id}/members/{userId}",
      successStatus: 204,
      summary: "Remove a member",
    })
    .input(spacePathSchema.extend({ userId: userIdSchema }))
    .output(z.void()),
  requestAllowance: authed
    .errors(conflictError)
    .route({
      description:
        "Asks the space's owners for a monthly draw. Replaces the caller's pending request.",
      method: "POST",
      path: "/spaces/{type}/{id}/allowance/grants",
      successStatus: 201,
      summary: "Request an allowance",
    })
    .input(
      spacePathSchema.extend({
        monthlyTokens: z.int().min(1).max(1_000_000_000),
        note: z.string().trim().max(500).default(""),
      })
    )
    .output(allowanceGrantSchema),
  setAllowance: authed
    .route({
      description: "`null` removes the pool.",
      method: "PUT",
      path: "/spaces/{type}/{id}/allowance",
      summary: "Set a space's monthly token pool",
    })
    .input(
      spacePathSchema.extend({
        monthlyTokens: z.int().min(0).max(1_000_000_000_000).nullable(),
      })
    )
    .output(spaceAllowanceSchema),
  setMember: authed
    .errors(conflictError)
    .route({
      description:
        "Adds or promotes. A sub-space's members must already be in its root space; a sub-space takes `owner` or `member`.",
      method: "PUT",
      path: "/spaces/{type}/{id}/members/{userId}",
      summary: "Add, promote or demote a member",
    })
    .input(
      spacePathSchema.extend({
        role: spaceRoleSchema.default("member"),
        userId: userIdSchema,
      })
    )
    .output(spaceMemberSchema),
  share: authed
    .route({
      description:
        "Shares something the caller owns (or may edit) to the space. Members of the space and its sub-spaces get `use` (library items) or `viewer` (chats).",
      method: "PUT",
      path: "/spaces/{type}/{id}/content",
      summary: "Share to a space",
    })
    .input(
      spacePathSchema.extend({
        resourceId: z.uuid(),
        resourceType: spaceContentTypeSchema,
      })
    )
    .output(spaceContentItemSchema),
  unshare: authed
    .route({
      method: "DELETE",
      path: "/spaces/{type}/{id}/content/{resourceType}/{resourceId}",
      successStatus: 204,
      summary: "Stop sharing to a space",
    })
    .input(
      spacePathSchema.extend({
        resourceId: z.uuid(),
        resourceType: spaceContentTypeSchema,
      })
    )
    .output(z.void()),
};

import { z } from "zod";

import { featureError } from "../errors";
import { grantIdSchema, shareLinkIdSchema } from "../schemas/common";
import {
  createGrantInputSchema,
  createShareLinkInputSchema,
  resourceGrantSchema,
  resourceRefSchema,
  sharedResourceSchema,
  shareLinkSchema,
  updateGrantInputSchema,
} from "../schemas/grants";
import { authed, open } from "./base";

export const grants = {
  create: authed
    .route({
      description:
        "Share (D13): grants a user, team (and its sub-teams) or org access. Re-granting a principal replaces its level.",
      method: "POST",
      path: "/grants",
      successStatus: 201,
      summary: "Share (grant access)",
    })
    .input(createGrantInputSchema)
    .output(resourceGrantSchema),
  list: authed
    .route({
      method: "GET",
      path: "/grants",
      summary: "List grants on a resource",
    })
    .input(resourceRefSchema)
    .output(z.array(resourceGrantSchema)),
  revoke: authed
    .route({
      method: "DELETE",
      path: "/grants/{id}",
      successStatus: 204,
      summary: "Revoke a grant",
    })
    .input(z.object({ id: grantIdSchema }))
    .output(z.void()),
  update: authed
    .route({
      method: "PATCH",
      path: "/grants/{id}",
      summary: "Change a grant level",
    })
    .input(updateGrantInputSchema)
    .output(resourceGrantSchema),
};

export const shareLinks = {
  create: authed
    .errors(featureError)
    .route({
      method: "POST",
      path: "/share-links",
      successStatus: 201,
      summary: "Create a share link",
    })
    .input(createShareLinkInputSchema)
    .output(shareLinkSchema),
  list: authed
    .route({ method: "GET", path: "/share-links", summary: "List share links" })
    .input(resourceRefSchema)
    .output(z.array(shareLinkSchema)),
  resolve: open
    .errors(featureError)
    .route({
      description:
        "Public and read-only: what a share link shows. Expired and revoked links are `NOT_FOUND`.",
      method: "GET",
      path: "/share/{token}",
      summary: "Open a share link",
    })
    .input(z.object({ token: z.string().min(22).max(128) }))
    .output(sharedResourceSchema),
  revoke: authed
    .route({
      method: "DELETE",
      path: "/share-links/{id}",
      successStatus: 204,
      summary: "Revoke a share link",
    })
    .input(z.object({ id: shareLinkIdSchema }))
    .output(z.void()),
};

import { z } from "zod";

import { conflictError, featureError } from "../errors";
import {
  artifactIdSchema,
  artifactVersionIdSchema,
  conversationIdSchema,
  fileIdSchema,
  grantIdSchema,
  pageOf,
} from "../schemas/common";
import {
  artifactDetailSchema,
  artifactGrantSchema,
  artifactListItemSchema,
  artifactPublicationSchema,
  artifactSchema,
  artifactVersionSchema,
  fileSchema,
  fileSearchHitSchema,
  fileSearchInputSchema,
  fileUrlSchema,
  listAllArtifactsInputSchema,
  listFilesInputSchema,
  publishedArtifactSchema,
  renameArtifactInputSchema,
  saveArtifactVersionInputSchema,
  saveWorkspaceArtifactInputSchema,
  shareArtifactInputSchema,
  uploadFileInputSchema,
  useArtifactInputSchema,
} from "../schemas/files";
import { authed, open } from "./base";

const byId = z.object({ id: fileIdSchema });

export const files = {
  delete: authed
    .route({
      method: "DELETE",
      path: "/files/{id}",
      successStatus: 204,
      summary: "Delete a file",
    })
    .input(byId)
    .output(z.void()),
  get: authed
    .route({ method: "GET", path: "/files/{id}", summary: "Get a file" })
    .input(byId)
    .output(fileSchema),
  getUrl: authed
    .route({
      description: "A short-lived signed download URL.",
      method: "GET",
      path: "/files/{id}/url",
      summary: "Get a download URL",
    })
    .input(byId)
    .output(fileUrlSchema),
  list: authed
    .route({ method: "GET", path: "/files", summary: "List files" })
    .input(listFilesInputSchema)
    .output(pageOf(fileSchema)),
  search: authed
    .errors(featureError)
    .route({
      description:
        "Semantic search over indexed files (what `file_search` uses).",
      method: "POST",
      path: "/files/search",
      summary: "Search file contents",
    })
    .input(fileSearchInputSchema)
    .output(z.array(fileSearchHitSchema)),
  upload: authed
    .errors(featureError)
    .route({
      description:
        "Multipart upload. Knowledge files are then parsed, chunked and embedded by a background job; poll `status`.",
      method: "POST",
      path: "/files",
      successStatus: 201,
      summary: "Upload a file",
    })
    .input(uploadFileInputSchema)
    .output(fileSchema),
};

const byArtifact = z.object({ id: artifactIdSchema });

export const artifacts = {
  delete: authed
    .route({
      description:
        "The owner only: deletes the artifact, every version and its shares.",
      method: "DELETE",
      path: "/artifacts/{id}",
      successStatus: 204,
      summary: "Delete an artifact",
    })
    .input(byArtifact)
    .output(z.void()),
  detail: authed
    .route({
      description:
        "The Artifacts page's full view (124): the artifact as its list row, and every version, oldest first. Open to the owner, people it's shared with, and whoever can read the chat that made it.",
      method: "GET",
      path: "/artifacts/{id}/detail",
      summary: "Get an artifact with its versions",
    })
    .input(byArtifact)
    .output(artifactDetailSchema),
  duplicate: authed
    .route({
      description:
        "Copies the latest version into a new artifact the caller owns, unshared.",
      method: "POST",
      path: "/artifacts/{id}/duplicate",
      successStatus: 201,
      summary: "Duplicate an artifact",
    })
    .input(byArtifact)
    .output(artifactListItemSchema),
  get: authed
    .route({
      method: "GET",
      path: "/artifacts/{id}",
      summary: "Get an artifact",
    })
    .input(z.object({ id: artifactIdSchema }))
    .output(artifactSchema),
  getVersion: authed
    .route({
      method: "GET",
      path: "/artifacts/{id}/versions/{versionId}",
      summary: "Get an artifact version",
    })
    .input(
      z.object({ id: artifactIdSchema, versionId: artifactVersionIdSchema })
    )
    .output(artifactVersionSchema),
  list: authed
    .route({
      description:
        "The chat's own artifacts, then those used in it from elsewhere (124).",
      method: "GET",
      path: "/conversations/{conversationId}/artifacts",
      summary: "List artifacts in a conversation",
    })
    .input(z.object({ conversationId: conversationIdSchema }))
    .output(z.array(artifactSchema)),
  listAll: authed
    .route({
      description:
        "The Artifacts page (124): artifacts the caller owns or that were shared with them, across chats, most recently viewed first.",
      method: "GET",
      path: "/artifacts",
      summary: "List my artifacts",
    })
    .input(listAllArtifactsInputSchema)
    .output(pageOf(artifactListItemSchema)),
  listGrants: authed
    .route({
      description: "Anyone who can see the artifact sees who it's shared with.",
      method: "GET",
      path: "/artifacts/{id}/grants",
      summary: "List an artifact's shares",
    })
    .input(byArtifact)
    .output(z.array(artifactGrantSchema)),
  listVersions: authed
    .route({
      description: "Every version, oldest first, for the before/after diff.",
      method: "GET",
      path: "/artifacts/{id}/versions",
      summary: "List artifact versions",
    })
    .input(z.object({ id: artifactIdSchema }))
    .output(z.array(artifactVersionSchema)),
  markViewed: authed
    .route({
      description:
        'Records that the caller opened it now, for the page\'s "Viewed …" and its order.',
      method: "POST",
      path: "/artifacts/{id}/viewed",
      successStatus: 204,
      summary: "Mark an artifact viewed",
    })
    .input(byArtifact)
    .output(z.void()),
  publication: authed
    .route({
      description:
        "The artifact's public link (125), or `null` while it isn't published. Anyone who can see the artifact sees it.",
      method: "GET",
      path: "/artifacts/{id}/publication",
      summary: "Get an artifact's public link",
    })
    .input(byArtifact)
    .output(artifactPublicationSchema.nullable()),
  publish: authed
    .errors(featureError)
    .route({
      description:
        "The owner only, for kinds that can be published (a Site, 125): publishes the latest version to a public link on the artifact runtime's origin. Publishing again keeps the link and moves it to the latest version. `FEATURE_DISABLED` (`publicLinks`) when the instance doesn't allow public links or has no artifact runtime; `VALIDATION` when the kind can't be published or the version fails its checks.",
      method: "POST",
      path: "/artifacts/{id}/publication",
      summary: "Publish an artifact",
    })
    .input(byArtifact)
    .output(artifactPublicationSchema),
  published: open
    .errors(featureError)
    .route({
      description:
        "Public and read-only: what a published link serves (125), for the artifact runtime to build and show. Unpublished or unknown tokens are `NOT_FOUND`.",
      method: "GET",
      path: "/published/{token}",
      summary: "Open a published artifact",
    })
    .input(z.object({ token: z.string().min(22).max(128) }))
    .output(publishedArtifactSchema),
  rename: authed
    .route({
      description: "The owner, or an `editor`.",
      method: "PATCH",
      path: "/artifacts/{id}",
      summary: "Rename an artifact",
    })
    .input(renameArtifactInputSchema)
    .output(artifactListItemSchema),
  saveFromWorkspace: authed
    .errors(featureError)
    .route({
      description:
        "\"Save as artifact\" (125): the files under a folder of the chat's workspace become a new artifact of `kind` that the caller owns, made in that chat. `VALIDATION` lists what fails the kind's checks; nothing is saved then. Needs write access to the chat.",
      method: "POST",
      path: "/conversations/{conversationId}/sandbox/artifacts",
      successStatus: 201,
      summary: "Save a workspace folder as an artifact",
    })
    .input(saveWorkspaceArtifactInputSchema)
    .output(artifactSchema),
  saveVersion: authed
    .errors(conflictError)
    .route({
      description:
        "A person's edit (126), saved as the next version after the kind's checks. The owner, or an `editor`. `CONFLICT` (`version_mismatch`) when `baseVersionId` is no longer the latest version.",
      method: "POST",
      path: "/artifacts/{id}/versions",
      successStatus: 201,
      summary: "Save an artifact version",
    })
    .input(saveArtifactVersionInputSchema)
    .output(artifactVersionSchema),
  share: authed
    .route({
      description:
        "The owner only: grants a user, team (and its sub-teams) or org `viewer` or `editor`. Re-sharing replaces the level.",
      method: "POST",
      path: "/artifacts/{id}/grants",
      successStatus: 201,
      summary: "Share an artifact",
    })
    .input(shareArtifactInputSchema)
    .output(artifactGrantSchema),
  unpublish: authed
    .route({
      description:
        "The owner only: takes the public link down. Its URL stops working, and publishing again makes a new one.",
      method: "DELETE",
      path: "/artifacts/{id}/publication",
      successStatus: 204,
      summary: "Unpublish an artifact",
    })
    .input(byArtifact)
    .output(z.void()),
  unshare: authed
    .route({
      description: "The owner, or the person a share was made to, dropping it.",
      method: "DELETE",
      path: "/artifacts/{id}/grants/{grantId}",
      successStatus: 204,
      summary: "Remove a share",
    })
    .input(z.object({ grantId: grantIdSchema, id: artifactIdSchema }))
    .output(z.void()),
  use: authed
    .route({
      description:
        '"Use in chat" (124): attaches the artifact to a chat the caller can write to. That chat\'s model sees its latest version and, for the owner or an `editor`, can make new versions of it.',
      method: "POST",
      path: "/artifacts/{id}/use",
      successStatus: 204,
      summary: "Use an artifact in a chat",
    })
    .input(useArtifactInputSchema)
    .output(z.void()),
};

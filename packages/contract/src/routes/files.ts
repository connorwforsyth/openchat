import { z } from "zod";

import { featureError } from "../errors";
import {
  artifactIdSchema,
  artifactVersionIdSchema,
  conversationIdSchema,
  fileIdSchema,
  pageOf,
} from "../schemas/common";
import {
  artifactSchema,
  artifactVersionSchema,
  fileSchema,
  fileSearchHitSchema,
  fileSearchInputSchema,
  fileUrlSchema,
  listFilesInputSchema,
  uploadFileInputSchema,
} from "../schemas/files";
import { authed } from "./base";

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

export const artifacts = {
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
      method: "GET",
      path: "/conversations/{conversationId}/artifacts",
      summary: "List artifacts in a conversation",
    })
    .input(z.object({ conversationId: conversationIdSchema }))
    .output(z.array(artifactSchema)),
  listVersions: authed
    .route({
      description: "Every version, oldest first, for the before/after diff.",
      method: "GET",
      path: "/artifacts/{id}/versions",
      summary: "List artifact versions",
    })
    .input(z.object({ id: artifactIdSchema }))
    .output(z.array(artifactVersionSchema)),
};

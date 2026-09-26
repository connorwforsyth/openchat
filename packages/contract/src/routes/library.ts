import { z } from "zod";

import { conflictError, featureError } from "../errors";
import {
  libraryItemIdSchema,
  libraryVersionIdSchema,
  pageInputSchema,
  pageOf,
} from "../schemas/common";
import {
  createLibraryItemInputSchema,
  duplicateLibraryItemInputSchema,
  getLibraryItemInputSchema,
  libraryExportSchema,
  libraryImportInputSchema,
  libraryItemDetailSchema,
  libraryItemSchema,
  libraryVersionSchema,
  listLibraryInputSchema,
  mcpConnectionStatusSchema,
  mcpToolSchema,
  publishToLibraryInputSchema,
  publishVersionInputSchema,
  restoreVersionInputSchema,
  setMaintainersInputSchema,
  updateLibraryItemInputSchema,
} from "../schemas/library";
import { authed } from "./base";

const byId = z.object({ id: libraryItemIdSchema });

export const library = {
  create: authed
    .route({
      description:
        "Creates a personal item owned by the caller. Versioned kinds start with a draft and no published version.",
      method: "POST",
      path: "/library",
      successStatus: 201,
      summary: "Create a library item",
    })
    .input(createLibraryItemInputSchema)
    .output(libraryItemDetailSchema),
  delete: authed
    .route({
      method: "DELETE",
      path: "/library/{id}",
      successStatus: 204,
      summary: "Delete a library item",
    })
    .input(byId)
    .output(z.void()),
  duplicate: authed
    .route({
      description: "Copies the item into the caller's library. Needs `view`.",
      method: "POST",
      path: "/library/{id}/duplicate",
      successStatus: 201,
      summary: "Duplicate into my library",
    })
    .input(duplicateLibraryItemInputSchema)
    .output(libraryItemDetailSchema),
  export: authed
    .route({
      description: "Needs `view`.",
      method: "GET",
      path: "/library/{id}/export",
      summary: "Export a library item",
    })
    .input(byId)
    .output(libraryExportSchema),
  get: authed
    .route({
      description:
        "`definition` is `null` for callers with only `use`. `revision=draft` needs `edit`.",
      method: "GET",
      path: "/library/{id}",
      summary: "Get a library item",
    })
    .input(getLibraryItemInputSchema)
    .output(libraryItemDetailSchema),
  getVersion: authed
    .route({
      method: "GET",
      path: "/library/{id}/versions/{versionId}",
      summary: "Get a version",
    })
    .input(
      z.object({ id: libraryItemIdSchema, versionId: libraryVersionIdSchema })
    )
    .output(libraryVersionSchema),
  import: authed
    .route({
      method: "POST",
      path: "/library/import",
      successStatus: 201,
      summary: "Import a library item",
    })
    .input(libraryImportInputSchema)
    .output(libraryItemDetailSchema),
  list: authed
    .route({ method: "GET", path: "/library", summary: "List library items" })
    .input(listLibraryInputSchema)
    .output(pageOf(libraryItemSchema)),
  listVersions: authed
    .route({
      description: "Published versions, newest first, then the draft.",
      method: "GET",
      path: "/library/{id}/versions",
      summary: "List versions",
    })
    .input(pageInputSchema.extend({ id: libraryItemIdSchema }))
    .output(pageOf(libraryVersionSchema)),
  publishToLibrary: authed
    .errors(featureError)
    .route({
      description:
        "Publish (D13): copies a published version into a team or org library. The team or org owns the copy and the caller becomes a maintainer.",
      method: "POST",
      path: "/library/{id}/publish",
      successStatus: 201,
      summary: "Publish to a team or org library",
    })
    .input(publishToLibraryInputSchema)
    .output(libraryItemDetailSchema),
  publishVersion: authed
    .errors(conflictError)
    .route({
      description:
        "Freezes the draft as the next published version. Versioned kinds only (`VALIDATION` otherwise).",
      method: "POST",
      path: "/library/{id}/versions",
      successStatus: 201,
      summary: "Publish the draft as a version",
    })
    .input(publishVersionInputSchema)
    .output(libraryVersionSchema),
  restoreVersion: authed
    .route({
      method: "POST",
      path: "/library/{id}/versions/{versionId}/restore",
      summary: "Restore a version into the draft",
    })
    .input(restoreVersionInputSchema)
    .output(libraryItemDetailSchema),
  setMaintainers: authed
    .errors(conflictError)
    .route({
      description:
        "Published items only. `CONFLICT` (`last_owner`) if it would leave none.",
      method: "PUT",
      path: "/library/{id}/maintainers",
      summary: "Set maintainers",
    })
    .input(setMaintainersInputSchema)
    .output(libraryItemSchema),
  update: authed
    .errors(conflictError)
    .route({
      method: "PATCH",
      path: "/library/{id}",
      summary: "Update a library item",
    })
    .input(updateLibraryItemInputSchema)
    .output(libraryItemDetailSchema),
};

export const mcp = {
  disconnect: authed
    .route({
      description: "Forgets the caller's OAuth tokens for this server.",
      method: "DELETE",
      path: "/mcp/{id}/oauth",
      successStatus: 204,
      summary: "Disconnect OAuth",
    })
    .input(byId)
    .output(z.void()),
  startOAuth: authed
    .route({
      description:
        "Starts the OAuth flow; the client opens `authorizationUrl`. The callback is a plain HTTP route, not part of this contract.",
      method: "POST",
      path: "/mcp/{id}/oauth",
      summary: "Start OAuth",
    })
    .input(byId)
    .output(z.object({ authorizationUrl: z.url() })),
  status: authed
    .route({
      method: "GET",
      path: "/mcp/{id}/status",
      summary: "Get connection status",
    })
    .input(byId)
    .output(mcpConnectionStatusSchema),
  tools: authed
    .route({ method: "GET", path: "/mcp/{id}/tools", summary: "List tools" })
    .input(byId)
    .output(z.array(mcpToolSchema)),
};

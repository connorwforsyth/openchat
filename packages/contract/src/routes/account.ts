import { z } from "zod";

import {
  conflictError,
  encryptionError,
  featureError,
  readinessError,
} from "../errors";
import {
  messageIdSchema,
  pageInputSchema,
  pageOf,
  providerKeyIdSchema,
} from "../schemas/common";
import { feedbackSchema, setFeedbackInputSchema } from "../schemas/feedback";
import { healthInputSchema, healthSchema } from "../schemas/health";
import {
  createProviderKeyInputSchema,
  listProviderKeysInputSchema,
  providerKeySchema,
  verifyProviderKeyOutputSchema,
} from "../schemas/keys";
import {
  memoryDocumentSchema,
  memoryModeSchema,
  memoryVersionSchema,
  revertMemoryInputSchema,
  updateMemoryInputSchema,
} from "../schemas/memory";
import {
  listModelsInputSchema,
  meSchema,
  publicConfigSchema,
  updateUserSettingsInputSchema,
  userSettingsSchema,
} from "../schemas/meta";
import { modelOptionSchema } from "../schemas/models";
import { authed, open } from "./base";

export const me = {
  get: authed
    .route({ method: "GET", path: "/me", summary: "Get the signed-in user" })
    .output(meSchema),
  settings: authed
    .route({ method: "GET", path: "/me/settings", summary: "Get my settings" })
    .output(userSettingsSchema),
  updateSettings: authed
    .route({
      method: "PATCH",
      path: "/me/settings",
      summary: "Update my settings",
    })
    .input(updateUserSettingsInputSchema)
    .output(userSettingsSchema),
};

export const meta = {
  config: open
    .route({
      description: "Brand, sign-in options, features and limits. Public.",
      method: "GET",
      path: "/config",
      summary: "Get public instance config",
    })
    .output(publicConfigSchema),
  health: open
    .errors(readinessError)
    .route({
      description:
        "Liveness and readiness for healthchecks. Any answer means the process is up; `status` is `ok` when the database answers and the job queue runs. With `ready=true` a degraded server answers `NOT_READY` (503) instead. Public.",
      method: "GET",
      path: "/health",
      summary: "Check server health",
    })
    .input(healthInputSchema)
    .output(healthSchema),
  models: authed
    .route({
      description:
        "Models for the picker, with availability for the given context's keys.",
      method: "GET",
      path: "/models",
      summary: "List models for the picker",
    })
    .input(listModelsInputSchema)
    .output(z.array(modelOptionSchema)),
};

export const memory = {
  get: authed
    .errors(featureError)
    .route({ method: "GET", path: "/memory", summary: "Get my memory" })
    .output(memoryDocumentSchema),
  revert: authed
    .errors(featureError)
    .route({
      description:
        "Undo: writes a new version with an earlier version's content.",
      method: "POST",
      path: "/memory/revert",
      summary: "Revert memory to a version",
    })
    .input(revertMemoryInputSchema)
    .output(memoryDocumentSchema),
  setMode: authed
    .errors(featureError)
    .route({ method: "PUT", path: "/memory/mode", summary: "Set memory mode" })
    .input(z.object({ mode: memoryModeSchema }))
    .output(memoryDocumentSchema),
  update: authed
    .errors({ ...conflictError, ...featureError })
    .route({ method: "PUT", path: "/memory", summary: "Replace my memory" })
    .input(updateMemoryInputSchema)
    .output(memoryDocumentSchema),
  versions: authed
    .errors(featureError)
    .route({
      method: "GET",
      path: "/memory/versions",
      summary: "List memory versions",
    })
    .input(pageInputSchema)
    .output(pageOf(memoryVersionSchema)),
};

const byMessage = z.object({ messageId: messageIdSchema });

export const feedback = {
  delete: authed
    .route({
      method: "DELETE",
      path: "/messages/{messageId}/feedback",
      successStatus: 204,
      summary: "Remove my feedback",
    })
    .input(byMessage)
    .output(z.void()),
  get: authed
    .route({
      description: "The caller's feedback on the message, or `null`.",
      method: "GET",
      path: "/messages/{messageId}/feedback",
      summary: "Get my feedback",
    })
    .input(byMessage)
    .output(feedbackSchema.nullable()),
  set: authed
    .route({
      method: "PUT",
      path: "/messages/{messageId}/feedback",
      summary: "Set feedback on a message",
    })
    .input(setFeedbackInputSchema)
    .output(feedbackSchema),
};

export const keys = {
  create: authed
    .errors(encryptionError)
    .route({
      description:
        "`apiKey` is write-only: encrypted at rest and never returned. `ENCRYPTION_UNAVAILABLE` when the server has no usable `ENCRYPTION_KEY`.",
      method: "POST",
      path: "/keys",
      successStatus: 201,
      summary: "Add a provider key",
    })
    .input(createProviderKeyInputSchema)
    .output(providerKeySchema),
  delete: authed
    .route({
      method: "DELETE",
      path: "/keys/{id}",
      successStatus: 204,
      summary: "Delete a provider key",
    })
    .input(z.object({ id: providerKeyIdSchema }))
    .output(z.void()),
  list: authed
    .route({
      description:
        "Keys the caller may see: their own, and their teams' and orgs' if they administer them.",
      method: "GET",
      path: "/keys",
      summary: "List provider keys",
    })
    .input(listProviderKeysInputSchema)
    .output(z.array(providerKeySchema)),
  verify: authed
    .route({
      method: "POST",
      path: "/keys/{id}/verify",
      summary: "Check a provider key",
    })
    .input(z.object({ id: providerKeyIdSchema }))
    .output(verifyProviderKeyOutputSchema),
};

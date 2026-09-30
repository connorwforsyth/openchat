import type { WorkspaceClient } from "@workspace/chat-ui/workspace/model/client";
import { type ApiClient, createApiClient } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { err, fromPromise, ok } from "@workspace/shared/result";

// The Workspace panel's port over the API (the contract's `sandbox` group),
// for one conversation. Writes, imports and deletes go by conversation, so
// the first one creates the workspace; a write's CONFLICT reasons come back
// as values the editor reacts to (Reload / Overwrite).

export interface SandboxErrorMessages {
  /** The provider isn't available (`FEATURE_DISABLED`). */
  readonly disabled: string;
  /** Anything else. */
  readonly failed: string;
}

const field = (cause: unknown, name: string): unknown =>
  typeof cause === "object" && cause !== null && name in cause
    ? (cause as Record<string, unknown>)[name]
    : undefined;

const codeOf = (cause: unknown): string | null => {
  const code = field(cause, "code");
  return typeof code === "string" ? code : null;
};

/** `CONFLICT`'s `data.reason` (`version_mismatch`, `already_exists`, …). */
const conflictReason = (cause: unknown): string | null => {
  if (codeOf(cause) !== "CONFLICT") {
    return null;
  }
  const reason = field(field(cause, "data"), "reason");
  return typeof reason === "string" ? reason : null;
};

/**
 * The app's client (same origin, the session cookie) with every request sent
 * `keepalive`, for the editor's saves that must land after the page is gone
 * (077). The shared client can't set `fetch` options per call, hence one of
 * its own.
 */
const createKeepaliveClient = (): Pick<ApiClient, "sandbox"> =>
  createApiClient({
    batch: false,
    fetch: (input, init) => fetch(input, { ...init, keepalive: true }),
  });

export const createApiSandboxClient = (
  client: Pick<ApiClient, "files" | "sandbox">,
  conversationId: ConversationId,
  messages: SandboxErrorMessages,
  keepaliveClient: () => Pick<ApiClient, "sandbox"> = createKeepaliveClient
): WorkspaceClient => {
  const describe = (cause: unknown): string =>
    codeOf(cause) === "FEATURE_DISABLED" ? messages.disabled : messages.failed;
  // Made on the first keepalive save: never during a server render.
  let outliving: Pick<ApiClient, "sandbox"> | null = null;
  const writer = (wanted: boolean | undefined): Pick<ApiClient, "sandbox"> => {
    if (!wanted) {
      return client;
    }
    outliving ??= keepaliveClient();
    return outliving;
  };
  return {
    deleteFile: (path) =>
      fromPromise(async () => {
        await client.sandbox.deleteFile({
          conversationId,
          path,
          recursive: false,
        });
      }, describe),
    importFile: (file) =>
      fromPromise(async () => {
        const uploaded = await client.files.upload({
          conversationId,
          file,
          purpose: "attachment",
        });
        return client.sandbox.importFile({
          conversationId,
          fileId: uploaded.id,
        });
      }, describe),
    listFiles: (id) =>
      fromPromise(
        client.sandbox.listFiles({ id, path: ".", recursive: true }),
        describe
      ),
    readFile: (id, path) =>
      fromPromise(client.sandbox.readFile({ id, path }), describe),
    reset: (id) => fromPromise(client.sandbox.reset({ id }), describe),
    writeFile: async ({ content, ifMatch, keepalive, path }) => {
      try {
        return ok(
          await writer(keepalive).sandbox.writeFile({
            content,
            conversationId,
            encoding: "utf8",
            ifMatch,
            path,
          })
        );
      } catch (cause) {
        const reason = conflictReason(cause);
        if (reason === "version_mismatch" || reason === "already_exists") {
          return err({ kind: reason });
        }
        return err({ kind: "failed", message: describe(cause) });
      }
    },
  };
};

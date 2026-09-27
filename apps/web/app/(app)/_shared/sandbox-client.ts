import type { SandboxPanelClient } from "@workspace/chat-ui/sandbox/model/client";
import type { ApiClient } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { fromPromise } from "@workspace/shared/result";

// The sandbox panel's port over the API (the contract's `sandbox` group),
// for one conversation. Commands run to completion on the server, so a
// command's output arrives in one piece when it finishes.

export interface SandboxErrorMessages {
  /** The provider isn't available (`FEATURE_DISABLED`). */
  readonly disabled: string;
  /** Anything else. */
  readonly failed: string;
}

const codeOf = (cause: unknown): string | null =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : null;

export const createApiSandboxClient = (
  client: Pick<ApiClient, "sandbox">,
  conversationId: ConversationId,
  messages: SandboxErrorMessages
): SandboxPanelClient => {
  const describe = (cause: unknown): string =>
    codeOf(cause) === "FEATURE_DISABLED" ? messages.disabled : messages.failed;
  return {
    create: () =>
      fromPromise(client.sandbox.create({ conversationId }), describe),
    exec: (id, command, onOutput) =>
      fromPromise(async () => {
        const result = await client.sandbox.exec({ command, id });
        if (result.stdout) {
          onOutput({ data: result.stdout, stream: "stdout" });
        }
        if (result.stderr) {
          onOutput({ data: result.stderr, stream: "stderr" });
        }
        return result;
      }, describe),
    exposePort: (id, port) =>
      fromPromise(client.sandbox.exposePort({ id, port }), describe),
    listFiles: (id) =>
      fromPromise(
        client.sandbox.listFiles({ id, path: ".", recursive: true }),
        describe
      ),
    readFile: (id, path) =>
      fromPromise(client.sandbox.readFile({ id, path }), describe),
    reset: (id) => fromPromise(client.sandbox.reset({ id }), describe),
  };
};

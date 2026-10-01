import { defineTool } from "@workspace/ai/tools/registry/define";
import { sandboxPreviewSchema } from "@workspace/contract/schemas/sandbox";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { z } from "zod";

import { wait, waitForListener } from "../listener";
import { STATIC_PREVIEW_PORT } from "../static-preview";
import {
  describeError,
  failure,
  type SandboxToolContext,
  type ToolSandbox,
  toolErrorSchema,
} from "../workspace";

export const previewInputSchema = z.object({
  port: z.int().min(1).max(65_535).describe("The port a server listens on"),
});

export const previewOutputSchema = z.union([
  sandboxPreviewSchema.extend({ status: z.literal("exposed") }),
  toolErrorSchema,
]);

// `preview` checks that something listens on the port before exposing it:
// otherwise a model that built a library with no server still gets a URL,
// and the user a dead panel. If the socket tables can't be read (just-bash
// has no /proc), it doesn't block the preview.

const startServerHint = (port: number) =>
  `Start the dev server in the background bound to 0.0.0.0 (e.g. \`npm run dev -- --host 0.0.0.0 --port ${port} &\`) and call preview again.`;

/** Waits briefly for a listener on `port`; `ok` means expose it. */
const awaitListener = async (
  sandbox: ToolSandbox,
  port: number,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined
): AsyncResult<void, string> => {
  const listening = await waitForListener(sandbox, port, { signal, sleep });
  if (!listening.ok) {
    return err(describeError(listening.error));
  }
  switch (listening.value) {
    case "loopback":
      return err(
        `The server on port ${port} only listens on localhost, which the preview can't reach. ${startServerHint(port)}`
      );
    case "none":
      return err(
        `Nothing is listening on port ${port}. ${startServerHint(port)}`
      );
    case "reachable":
    case "unknown":
      return ok(undefined);
    default:
      return listening.value satisfies never;
  }
};

export const preview = defineTool({
  approval: "auto",
  capability: "sandbox",
  description: `Expose a port a server in the workspace listens on and get a URL the user can open in the preview panel. This is for dev servers (Vite and the like): static HTML, CSS and JS preview on their own when you write the .html file, so don't start a server for them. Start the server first, in the background and bound to 0.0.0.0 (e.g. \`npm run dev -- --host 0.0.0.0 --port 5173 &\`); a server bound to localhost can't be previewed. Don't use port ${STATIC_PREVIEW_PORT}; the static preview has it. Only preview something that serves pages: a library or script with no server has nothing to show.`,
  execute: async ({ port }, { signal, workspace }: SandboxToolContext) => {
    const listening = await awaitListener(
      workspace.sandbox,
      port,
      workspace.sleep ?? wait,
      signal
    );
    if (!listening.ok) {
      return failure(listening.error);
    }
    const exposed = await workspace.sandbox.exposePort(port);
    return exposed.ok
      ? { ...exposed.value, status: "exposed" as const }
      : failure(describeError(exposed.error));
  },
  input: previewInputSchema,
  name: "preview",
  output: previewOutputSchema,
});

import { defineTool } from "@workspace/ai/tools/registry/define";
import { sandboxPathSchema } from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

import { WORKDIR } from "../../paths";
import { changeFile, fileChangeOutputSchema } from "../file-change";
import { type SandboxToolContext, STATIC_PREVIEW_NOTE } from "../workspace";

// `write` only writes inside `/work` (D7, 074). How the change is proposed,
// reviewed and applied is in `../file-change.ts`.

export const writeInputSchema = z.object({
  content: z.string().max(5_000_000),
  path: sandboxPathSchema,
});

export const write = defineTool({
  // A file change asks, so each is reviewed per hunk before it lands (D16),
  // unless an agent's author sets it to `auto` by name.
  approval: "ask",
  capability: "sandbox",
  description: `Create or overwrite a text file in the workspace (${WORKDIR}, the user's Files panel). The change is shown to the user as a diff and may be applied only in part. ${STATIC_PREVIEW_NOTE}`,
  execute: (input, ctx: SandboxToolContext) =>
    changeFile(ctx, { input, kind: "write" }),
  input: writeInputSchema,
  name: "write",
  output: fileChangeOutputSchema,
});

import { defineTool } from "@workspace/ai/tools/registry/define";
import { sandboxPathSchema } from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

import { WORKDIR } from "../../paths";
import { changeFile, fileChangeOutputSchema } from "../file-change";
import { type SandboxToolContext, STATIC_PREVIEW_NOTE } from "../workspace";

// `edit` only edits inside `/work` (D7, 074). How the change is proposed,
// reviewed and applied is in `../file-change.ts`.

export const editInputSchema = z.object({
  newString: z.string().max(1_000_000),
  oldString: z
    .string()
    .min(1)
    .max(1_000_000)
    .describe("Exact text to replace; must be unique unless replaceAll"),
  path: sandboxPathSchema,
  replaceAll: z.boolean().optional(),
});

export const edit = defineTool({
  // A file change asks, so each is reviewed per hunk before it lands (D16),
  // unless an agent's author sets it to `auto` by name.
  approval: "ask",
  capability: "sandbox",
  description: `Replace an exact string in a text file in the workspace (${WORKDIR}, the user's Files panel). The change is shown to the user as a diff and may be applied only in part. ${STATIC_PREVIEW_NOTE}`,
  execute: (input, ctx: SandboxToolContext) =>
    changeFile(ctx, { input, kind: "edit" }),
  input: editInputSchema,
  name: "edit",
  output: fileChangeOutputSchema,
});

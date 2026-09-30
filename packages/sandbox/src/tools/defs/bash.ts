import { defineTool } from "@workspace/ai/tools/registry/define";
import {
  execResultSchema,
  sandboxPathSchema,
} from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

import { WORKDIR } from "../../paths";
import {
  describeError,
  failure,
  type SandboxToolContext,
  toolErrorSchema,
} from "../workspace";

// `bash` isn't held to `/work` as the file tools are: the sandbox itself is
// its boundary. The run's abort signal reaches the command, so Stop kills
// it (072).

export const bashInputSchema = z.object({
  command: z.string().min(1).max(100_000).describe("The command to run"),
  cwd: sandboxPathSchema
    .optional()
    .describe("Working directory; defaults to the workspace root"),
  timeoutMs: z
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .describe("Kill the command after this long"),
});

export const bashOutputSchema = z.union([
  execResultSchema.extend({ status: z.literal("ran") }),
  toolErrorSchema,
]);

export const bash = defineTool({
  // The sandbox contains it, so a plain chat runs commands without asking.
  approval: "auto",
  capability: "sandbox",
  description: `Run a bash command in the chat's workspace, a sandboxed machine. The working directory is the workspace root, ${WORKDIR}; files there persist between calls and the user sees them in the Files panel. Run commands yourself rather than asking the user to.`,
  execute: async (
    { command, cwd, timeoutMs },
    { emit, signal, toolCallId, workspace }: SandboxToolContext
  ) => {
    const result = await workspace.sandbox.exec(command, {
      cwd,
      onOutput: emit
        ? (chunk) => emit({ chunk, toolCallId, type: "output" })
        : undefined,
      signal,
      timeoutMs,
    });
    return result.ok
      ? { ...result.value, status: "ran" as const }
      : failure(describeError(result.error));
  },
  input: bashInputSchema,
  name: "bash",
  output: bashOutputSchema,
});

import { defineTool } from "@workspace/ai/tools/registry/define";
import { sandboxPathSchema } from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

import { WORKDIR } from "../../paths";
import {
  failure,
  readText,
  type SandboxToolContext,
  toolErrorSchema,
} from "../workspace";

// `read` only reads files inside `/work` (D7, 074), by the same rule as the
// Files panel's routes; anywhere else is an error the model can correct.

/** Largest file `read` returns whole; bigger ones need `offset`/`limit`. */
const MAX_READ_CHARS = 200_000;

export const readInputSchema = z.object({
  limit: z.int().min(1).max(10_000).optional().describe("Lines to return"),
  offset: z.int().min(1).optional().describe("1-based line to start at"),
  path: sandboxPathSchema,
});

export const readOutputSchema = z.union([
  z.object({
    content: z.string(),
    path: z.string(),
    status: z.literal("read"),
    totalLines: z.int().min(0),
    truncated: z.boolean(),
  }),
  toolErrorSchema,
]);

const sliceLines = (
  text: string,
  offset: number | undefined,
  limit: number | undefined
) => {
  const lines = text.split("\n");
  const start = (offset ?? 1) - 1;
  const end = limit === undefined ? lines.length : start + limit;
  return { content: lines.slice(start, end).join("\n"), total: lines.length };
};

export const read = defineTool({
  approval: "auto",
  capability: "sandbox",
  description: `Read a text file from the workspace (${WORKDIR}, the user's Files panel), optionally a range of lines. Paths must be inside ${WORKDIR}; relative paths are relative to it.`,
  execute: async (
    { limit, offset, path },
    { workspace }: SandboxToolContext
  ) => {
    const text = await readText(workspace.sandbox, path, {
      missingIsEmpty: false,
    });
    if (!text.ok) {
      return failure(text.error);
    }
    const { content, total } = sliceLines(text.value.text, offset, limit);
    const truncated = content.length > MAX_READ_CHARS;
    return {
      content: truncated ? content.slice(0, MAX_READ_CHARS) : content,
      path,
      status: "read" as const,
      totalLines: total,
      truncated,
    };
  },
  input: readInputSchema,
  name: "read",
  output: readOutputSchema,
});

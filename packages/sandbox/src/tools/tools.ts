import { toAiSdkTool } from "@workspace/ai/tools/registry/to-ai-sdk";
import type { Tool } from "ai";

import type { OutputChunk } from "../ports/sandbox";
import { bash } from "./defs/bash";
import { edit } from "./defs/edit";
import { preview } from "./defs/preview";
import { read } from "./defs/read";
import { write } from "./defs/write";
import { wait } from "./listener";
import type { ReviewLookup, SandboxToolRun, ToolSandbox } from "./workspace";

// The agent's sandbox tools (D7) over any `Sandbox`: `bash`, `read`,
// `write`, `edit` and `preview`. Each is defined in its own file in `defs/`
// (080), over what they share in `workspace.ts` and `file-change.ts`. This
// module stays for one release so callers keep working: `createSandboxTools`
// binds the definitions to a sandbox and hands back the AI SDK tools, and
// everything that used to be written here is still exported from here.

// biome-ignore lint/performance/noBarrelFile: the old import paths keep working for one release (080).
export { bashInputSchema, bashOutputSchema } from "./defs/bash";
export { editInputSchema } from "./defs/edit";
export { previewInputSchema, previewOutputSchema } from "./defs/preview";
export { readInputSchema, readOutputSchema } from "./defs/read";
export { writeInputSchema } from "./defs/write";
export {
  applySandboxChange,
  baseHashOf,
  contentHash,
  type FileChangeOutput,
  fileChangeOutputSchema,
  proposeSandboxChange,
  reviewFeedback,
} from "./file-change";
export type { Review, ReviewLookup, ToolSandbox } from "./workspace";

export const SANDBOX_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "preview",
] as const;
export type SandboxToolName = (typeof SANDBOX_TOOL_NAMES)[number];

export interface SandboxToolsOptions {
  /**
   * Called once a `write` or `edit` has landed (some of it applied), with
   * the path it was given; the static preview (067) hangs off it. It must
   * not fail: the change is already made.
   */
  readonly onChanged?: (path: string) => Promise<void>;
  /** Streams `bash` output to the panel as it arrives. */
  readonly onOutput?: (toolCallId: string, chunk: OutputChunk) => void;
  readonly reviewFor?: ReviewLookup;
  readonly sandbox: ToolSandbox;
  /** Waits between listener probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const createSandboxTools = ({
  onChanged,
  onOutput,
  reviewFor,
  sandbox,
  sleep = wait,
}: SandboxToolsOptions): Record<SandboxToolName, Tool> => {
  const run: SandboxToolRun = {
    emit: onOutput
      ? ({ chunk, toolCallId }) => onOutput(toolCallId, chunk)
      : undefined,
    workspace: { onChanged, reviewFor, sandbox, sleep },
  };
  return {
    bash: toAiSdkTool(bash, run),
    edit: toAiSdkTool(edit, run),
    preview: toAiSdkTool(preview, run),
    read: toAiSdkTool(read, run),
    write: toAiSdkTool(write, run),
  };
};

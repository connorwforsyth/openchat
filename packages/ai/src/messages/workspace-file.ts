import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { sandboxPathSchema } from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

// An `@file` mention of a file in the chat's workspace (D7). The composer
// sends it as a `data-workspace-file` part beside the text that names it;
// the contract leaves a data part's shape to the feature that sends it, so
// this is that shape. The server reads the file when the turn starts, so
// the model sees what's in the workspace now, not when the message was
// written.

/** The data part name: `data-workspace-file` in AI SDK terms. */
export const WORKSPACE_FILE_DATA = "workspace-file";

export const workspaceFileRefSchema = z.object({
  /** As the Files panel shows it: relative to the workspace root, or absolute under it. */
  path: sandboxPathSchema,
});
export type WorkspaceFileRef = z.infer<typeof workspaceFileRefSchema>;

/** The workspace files a message's parts mention, first mention first, once each. Pure. */
export const workspaceFileRefs = (
  parts: readonly MessagePart[]
): readonly WorkspaceFileRef[] => {
  const seen = new Set<string>();
  return parts.flatMap((part) => {
    if (part.type !== "data" || part.name !== WORKSPACE_FILE_DATA) {
      return [];
    }
    const ref = workspaceFileRefSchema.safeParse(part.data);
    if (!ref.success || seen.has(ref.data.path)) {
      return [];
    }
    seen.add(ref.data.path);
    return [ref.data];
  });
};

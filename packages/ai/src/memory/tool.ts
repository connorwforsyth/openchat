import type { Tool } from "ai";

import { toAiSdkTool } from "../tools/registry/to-ai-sdk";
import {
  type UpdateMemoryToolDeps,
  updateMemoryTool,
} from "../tools/registry/update-memory";

// `update_memory` is defined in the tool registry
// (`tools/registry/update-memory.ts`, 080). This factory stays for one
// release so callers keep working: it binds the definition to a user, the
// answer the edit comes from and a store, and hands back the AI SDK tool.

// biome-ignore lint/performance/noBarrelFile: the old import path keeps working for one release (080).
export {
  type UpdateMemoryToolDeps,
  type UpdateMemoryToolOutput,
  updateMemory,
  updateMemoryToolOutputSchema,
} from "../tools/registry/update-memory";

export const createUpdateMemoryTool = ({
  maxChars,
  origin,
  store,
  userId,
}: UpdateMemoryToolDeps): Tool =>
  toAiSdkTool(updateMemoryTool, {
    actor: { userId },
    conversation: {
      id: origin.conversationId,
      messageId: origin.messageId,
      runId: origin.runId,
    },
    ports: { maxChars, store },
  });

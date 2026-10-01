import { isSkillAuthoringTool } from "@workspace/ai/tools/registry/skill-authoring";
import type { Message } from "@workspace/contract/schemas/messages";

// The skill tools (128) change the library under the chat: a published skill
// belongs in the composer's + menu and `/` at once (127's lists are
// react-query), so the chat refetches the library whenever another skill
// call settles.

/** How many skill-tool results the branch has settled. Pure. */
export const skillRevision = (
  messages: readonly Pick<Message, "parts">[]
): number => {
  let revision = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "tool-result" &&
        isSkillAuthoringTool(part.toolName) &&
        part.output.status === "success"
      ) {
        revision += 1;
      }
    }
  }
  return revision;
};

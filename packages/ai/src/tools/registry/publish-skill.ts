import { defineTool, type ToolContext } from "./define";
import {
  PUBLISH_SKILL_TOOL,
  publishSkillInputSchema,
  type SkillAuthoringPorts,
  skillAuthoringModelText,
  skillAuthoringOutputSchema,
} from "./skill-authoring";

// `publish_skill` (128): publishes a skill's draft as its next version,
// through the library's own publishing (`packages/server/src/library/
// publishing.ts`), and, given a team or org library, puts a copy there as
// the Library's Publish dialog does. The person approves every call, and
// the approval says which library it lands in. What the three skill tools
// share is in `skill-authoring.ts`.

export const publishSkillTool = defineTool({
  // Always asks: publishing changes what other people get. The turn holds
  // it to `ask` even where an agent sets its tools to `auto`.
  approval: "ask",
  capability: "skills",
  description:
    "Publish a skill's draft as its next version, so people can pick it in chats. Leave out library to publish it in the person's own library; name a team or org library to publish a copy there too. The person approves it first.",
  execute: (
    input,
    { ports }: ToolContext<{ readonly ports: SkillAuthoringPorts }>
  ) => ports.publish(input),
  input: publishSkillInputSchema,
  modelText: skillAuthoringModelText,
  name: PUBLISH_SKILL_TOOL,
  output: skillAuthoringOutputSchema,
});

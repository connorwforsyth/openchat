import { defineTool, type ToolContext } from "./define";
import {
  CREATE_SKILL_TOOL,
  createSkillInputSchema,
  type SkillAuthoringPorts,
  skillAuthoringModelText,
  skillAuthoringOutputSchema,
} from "./skill-authoring";

// `create_skill` (128): writes a new skill with the person, as a draft in
// their own library. It's theirs to publish (`publish_skill`); until then
// nobody else sees it, and it isn't offered in chats. What the three skill
// tools share is in `skill-authoring.ts`.

export const createSkillTool = defineTool({
  // It adds something to the person's library, so it asks first, like an
  // artifact does.
  approval: "ask",
  capability: "skills",
  description:
    "Create a skill: reusable instructions (SKILL.md) a model follows for a kind of task, with optional small text files. It's saved as a draft in the person's own library; publish it with publish_skill to use it in chats. Use it when the person asks to make a skill, or to keep a way of working for later.",
  execute: (
    input,
    { ports }: ToolContext<{ readonly ports: SkillAuthoringPorts }>
  ) => ports.create(input),
  input: createSkillInputSchema,
  modelText: skillAuthoringModelText,
  name: CREATE_SKILL_TOOL,
  output: skillAuthoringOutputSchema,
});

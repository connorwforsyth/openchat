import { defineTool, type ToolContext } from "./define";
import {
  type SkillAuthoringPorts,
  skillAuthoringModelText,
  skillAuthoringOutputSchema,
  UPDATE_SKILL_TOOL,
  updateSkillInputSchema,
} from "./skill-authoring";

// `update_skill` (128): saves a skill's draft again, for a skill the person
// may edit (the library's `edit`). What's published doesn't change until
// `publish_skill`. What the three skill tools share is in
// `skill-authoring.ts`.

export const updateSkillTool = defineTool({
  // A change to something in the person's library, so it asks first.
  approval: "ask",
  capability: "skills",
  description:
    "Change a skill's draft: its name, description, SKILL.md instructions (the whole new text, not a diff) or bundled files. Only for a skill the person can edit. The published version stays as it is until publish_skill.",
  execute: (
    input,
    { ports }: ToolContext<{ readonly ports: SkillAuthoringPorts }>
  ) => ports.update(input),
  input: updateSkillInputSchema,
  modelText: skillAuthoringModelText,
  name: UPDATE_SKILL_TOOL,
  output: skillAuthoringOutputSchema,
});

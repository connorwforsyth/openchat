import type { Tool } from "ai";

import { createSkillTool } from "./create-skill";
import { publishSkillTool } from "./publish-skill";
import type {
  SkillAuthoringPorts,
  SkillAuthoringTool,
} from "./skill-authoring";
import { toAiSdkTool } from "./to-ai-sdk";
import { updateSkillTool } from "./update-skill";

// The three skill-authoring tools (128) bound to one run's ports, keyed by
// name, for the turn resolver.

export const createSkillAuthoringTools = (
  ports: SkillAuthoringPorts
): Readonly<Record<SkillAuthoringTool, Tool>> => ({
  [createSkillTool.name]: toAiSdkTool(createSkillTool, { ports }),
  [publishSkillTool.name]: toAiSdkTool(publishSkillTool, { ports }),
  [updateSkillTool.name]: toAiSdkTool(updateSkillTool, { ports }),
});

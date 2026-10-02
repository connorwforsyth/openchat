import { createArtifactTool } from "./create-artifact";
import { createSkillTool } from "./create-skill";
import type { AnyToolDefinition, ToolCapability } from "./define";
import { fileSearch } from "./file-search";
import { generateImageTool } from "./generate-image";
import { loadSkillTool } from "./load-skill";
import { publishSkillTool } from "./publish-skill";
import { updateArtifactTool } from "./update-artifact";
import { updateMemoryTool } from "./update-memory";
import { updateSkillTool } from "./update-skill";
import { webSearch } from "./web-search";

// The registry (080): definitions by name, and the one place to read each
// tool's default approval and what it needs. It builds a map; it isn't a
// barrel, and importing a definition's own file is still how to bind one
// (that keeps its types).
//
// This package can't see the sandbox tools (`@workspace/sandbox` depends on
// the server, which depends on this), so `aiBuiltinTools` holds the
// built-ins written here and `@workspace/sandbox/tools/registry` builds the
// whole set. See the README beside this file.

export interface ToolRegistry<
  Definition extends AnyToolDefinition = AnyToolDefinition,
> {
  /** Every tool's default approval, by name. Defaults only: nothing decides a call from these yet. */
  readonly approvals: Readonly<Record<string, Definition["approval"]>>;
  readonly definitions: readonly Definition[];
  readonly get: (name: string) => Definition | undefined;
  readonly names: readonly string[];
  /** The tools that need `capability` to be offered (the sandbox's, say). */
  readonly withCapability: (capability: ToolCapability) => readonly string[];
}

/** A registry over `definitions`. Two tools with one name is a bug, so it throws. */
export const createToolRegistry = <Definition extends AnyToolDefinition>(
  definitions: readonly Definition[]
): ToolRegistry<Definition> => {
  const byName = new Map<string, Definition>();
  for (const definition of definitions) {
    if (byName.has(definition.name)) {
      throw new Error(`two tools are named ${definition.name}`);
    }
    byName.set(definition.name, definition);
  }
  return {
    approvals: Object.fromEntries(
      definitions.map(({ approval, name }) => [name, approval])
    ),
    definitions,
    get: (name) => byName.get(name),
    names: [...byName.keys()],
    withCapability: (capability) =>
      definitions
        .filter((definition) => definition.capability === capability)
        .map((definition) => definition.name),
  };
};

/** The built-in tools written in this package. */
export const AI_BUILTIN_TOOLS = [
  fileSearch,
  webSearch,
  updateMemoryTool,
  createArtifactTool,
  updateArtifactTool,
  generateImageTool,
  loadSkillTool,
  createSkillTool,
  updateSkillTool,
  publishSkillTool,
] as const;

export const aiBuiltinTools =
  createToolRegistry<AnyToolDefinition>(AI_BUILTIN_TOOLS);

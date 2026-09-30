import type { AnyToolDefinition } from "@workspace/ai/tools/registry/define";
import {
  aiBuiltinTools,
  createToolRegistry,
} from "@workspace/ai/tools/registry/index";

import { bash } from "./defs/bash";
import { edit } from "./defs/edit";
import { preview } from "./defs/preview";
import { read } from "./defs/read";
import { write } from "./defs/write";

// Every built-in tool in one registry (080). It's assembled here because
// this is the first package that can see them all: `@workspace/ai` holds
// `defineTool` and the tools that need only its own ports, and the sandbox
// tools are written here, over this package's `Sandbox` port, which
// `@workspace/ai` can't import (this package depends on the server, which
// depends on it).

/** The sandbox tools, in the order `SANDBOX_TOOL_NAMES` lists them. */
export const SANDBOX_TOOLS = [bash, read, write, edit, preview] as const;

export const builtinTools = createToolRegistry<AnyToolDefinition>([
  ...aiBuiltinTools.definitions,
  ...SANDBOX_TOOLS,
]);

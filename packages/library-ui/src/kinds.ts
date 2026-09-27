import type { LibraryKind } from "@workspace/contract/schemas/library";

// Not a client module, so server pages can check a route's kind with it.

/** The kinds the library lists and builds, in menu order (presets arrive with settings). */
export const BUILDABLE_KINDS = [
  "agent",
  "prompt",
  "skill",
  "mcp_server",
] as const satisfies readonly LibraryKind[];

export type BuildableKind = (typeof BUILDABLE_KINDS)[number];

import { createHash } from "node:crypto";

import type { ToolFilter } from "./server-config";

// Tool names across servers (ported from LibreChat's `normalizeServerName`
// and its MCP tool keys, with our separator). The model sees
// `server__tool`: unique across servers, and inside what every provider
// accepts for a function name (OpenAI's `^[a-zA-Z0-9_-]{1,64}$` is the
// strictest). The server part never contains `__`, so the first `__`
// always splits a name back apart.

export const TOOL_NAME_SEPARATOR = "__";
export const TOOL_NAME_MAX = 64;
const SERVER_PART_MAX = 24;

const UNSAFE = /[^a-zA-Z0-9_-]+/g;
const REPEATED_UNDERSCORES = /_{2,}/g;
const EDGE_UNDERSCORES = /^_+|_+$/g;

const shortHash = (value: string, length = 8): string =>
  createHash("sha256").update(value).digest("hex").slice(0, length);

/** A tool or server name reduced to provider-safe characters. */
export const safeToolName = (name: string): string => {
  const cleaned = name.replace(UNSAFE, "_");
  // Names made only of unsafe characters still need to stay distinct.
  return cleaned.replace(/_/g, "") === "" ? `t_${shortHash(name)}` : cleaned;
};

/** The server half of a tool name: short, safe, and free of `__`. */
export const normalizeServerName = (name: string): string => {
  const cleaned = name
    .toLowerCase()
    .replace(UNSAFE, "_")
    .replace(REPEATED_UNDERSCORES, "_")
    .replace(EDGE_UNDERSCORES, "");
  const base = cleaned === "" ? `server_${shortHash(name)}` : cleaned;
  return base.length > SERVER_PART_MAX
    ? `${base.slice(0, SERVER_PART_MAX - 7).replace(EDGE_UNDERSCORES, "")}_${shortHash(name, 6)}`
    : base;
};

/** `server__tool`, cut to fit with a hash so two long names never meet. */
export const namespacedToolName = (
  serverName: string,
  tool: string
): string => {
  const full = `${normalizeServerName(serverName)}${TOOL_NAME_SEPARATOR}${safeToolName(tool)}`;
  return full.length <= TOOL_NAME_MAX
    ? full
    : `${full.slice(0, TOOL_NAME_MAX - 9)}_${shortHash(full)}`;
};

/**
 * Whether to offer a tool, by the server's name for it. An agent's subset
 * (`mcpServers[].tools`) narrows the server's own allow list; deny wins.
 */
export const isToolAllowed = (
  tool: string,
  filter: ToolFilter,
  subset?: readonly string[]
): boolean => {
  const matches = (names: readonly string[]) =>
    names.includes(tool) || names.includes(safeToolName(tool));
  if (matches(filter.deny)) {
    return false;
  }
  if (filter.allow && !matches(filter.allow)) {
    return false;
  }
  return subset === undefined || matches(subset);
};

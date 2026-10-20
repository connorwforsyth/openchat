import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  Connector,
  ConnectorList,
  ConnectorToolList,
} from "@workspace/contract/schemas/library";

// A new chat's MCP server choices (188), made before the chat exists. They
// can't be saved yet, so they're kept here, shown over the defaults, and
// saved once the first send has made the chat. Pure.

export type PendingChange =
  | {
      readonly enabled: boolean;
      readonly id: LibraryItemId;
      readonly kind: "server";
    }
  | {
      readonly enabled: boolean;
      readonly id: LibraryItemId;
      readonly kind: "tool";
      readonly tool: string;
    };

const sameTarget = (a: PendingChange, b: PendingChange): boolean =>
  a.kind === b.kind &&
  a.id === b.id &&
  (a.kind === "server" || (b.kind === "tool" && a.tool === b.tool));

/** Adds a change, replacing an earlier one for the same switch. */
export const addPending = (
  pending: readonly PendingChange[],
  change: PendingChange
): readonly PendingChange[] => [
  ...pending.filter((each) => !sameTarget(each, change)),
  change,
];

const applyTo = (
  server: Connector,
  pending: readonly PendingChange[]
): Connector => {
  let next = server;
  for (const change of pending) {
    if (change.id !== server.id) {
      continue;
    }
    if (change.kind === "server") {
      next = server.lock ? next : { ...next, enabled: change.enabled };
    } else if (!next.requiredTools.includes(change.tool)) {
      const others = next.disabledTools.filter((name) => name !== change.tool);
      next = {
        ...next,
        disabledTools: change.enabled
          ? others
          : [...others, change.tool].sort(),
      };
    }
  }
  const customized =
    next.enabled !== server.enabled ||
    next.disabledTools.join("\n") !== server.disabledTools.join("\n");
  return { ...next, customized };
};

/** The defaults with a new chat's changes shown over them. */
export const withPending = (
  list: ConnectorList,
  pending: readonly PendingChange[]
): ConnectorList => {
  if (pending.length === 0) {
    return list;
  }
  const connectors = list.connectors.map((each) => applyTo(each, pending));
  return {
    ...list,
    connectors,
    customized: connectors.some((each) => each.customized),
  };
};

/** A server's tools with the pending changes' switches shown. */
export const toolsWithPending = (
  server: Connector | undefined,
  tools: ConnectorToolList
): ConnectorToolList =>
  server
    ? {
        ...tools,
        tools: tools.tools.map((tool) => ({
          ...tool,
          enabled:
            tool.lock !== null || !server.disabledTools.includes(tool.name),
        })),
      }
    : tools;

import type { Connector } from "@workspace/contract/schemas/library";

// The composer's view of a chat's connectors (188). Pure, so what the menu
// and `/` offer is tested without rendering.

/**
 * What a chat can switch: connectors this surface can run. One that needs
 * the operator's setup, or the desktop app, can't be used here either way.
 */
export const usableConnectors = (
  connectors: readonly Connector[]
): readonly Connector[] =>
  connectors.filter(
    (connector) => connector.availability.state === "available"
  );

/**
 * `/` matches for a query: usable, unlocked connectors whose name or title
 * contains it (case-insensitive). An empty query lists none, so a bare `/`
 * stays about prompts and commands.
 */
export const matchConnectors = (
  connectors: readonly Connector[],
  query: string
): readonly Connector[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  return usableConnectors(connectors).filter(
    (connector) =>
      connector.lock === null &&
      (connector.name.toLowerCase().includes(needle) ||
        connector.title.toLowerCase().includes(needle))
  );
};

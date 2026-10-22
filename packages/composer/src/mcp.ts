import type { Connector } from "@workspace/contract/schemas/library";

// The composer's view of a chat's servers (188). Pure, so what the menu
// and `/` offer is tested without rendering.

/**
 * What a chat can switch: servers this surface can run. One that needs
 * the operator's setup, or the desktop app, can't be used here either way.
 */
export const usableMcpServers = (
  servers: readonly Connector[]
): readonly Connector[] =>
  servers.filter((server) => server.availability.state === "available");

/**
 * `/` matches for a query: usable, unlocked servers whose name or title
 * contains it (case-insensitive). An empty query lists none, so a bare `/`
 * stays about prompts and commands.
 */
export const matchMcpServers = (
  servers: readonly Connector[],
  query: string
): readonly Connector[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  return usableMcpServers(servers).filter(
    (server) =>
      server.lock === null &&
      (server.name.toLowerCase().includes(needle) ||
        server.title.toLowerCase().includes(needle))
  );
};

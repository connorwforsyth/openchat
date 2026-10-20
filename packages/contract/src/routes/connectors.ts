import {
  connectorListSchema,
  connectorSchema,
  setConnectorEnabledInputSchema,
} from "../schemas/library";
import { authed } from "./base";

// Connectors (184): one user's view of the MCP servers they can use, merged
// from the operator's catalog (app.config.yaml) and their library, and the
// switch that turns each on or off for them. Connecting and disconnecting
// OAuth stay on the `mcp` group (`/mcp/{id}/oauth`).

export const connectors = {
  list: authed
    .route({
      description:
        "The caller's connectors: the operator's catalog and the MCP servers they own or were shared, each with whether it's on and whether they may change that.",
      method: "GET",
      path: "/connectors",
      summary: "List connectors",
    })
    .output(connectorListSchema),
  setEnabled: authed
    .route({
      description:
        "Turns a connector on or off for the caller. FORBIDDEN when the operator locked it; NOT_FOUND when the caller can't use it.",
      method: "PUT",
      path: "/connectors/{id}/enabled",
      summary: "Turn a connector on or off",
    })
    .input(setConnectorEnabledInputSchema)
    .output(connectorSchema),
};

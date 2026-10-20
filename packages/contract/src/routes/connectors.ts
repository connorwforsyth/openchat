import { z } from "zod";

import {
  connectorListSchema,
  connectorSchema,
  connectorToolListSchema,
  connectorToolSchema,
  listConnectorsInputSchema,
  listConnectorToolsInputSchema,
  resetConversationConnectorsInputSchema,
  setConnectorEnabledInputSchema,
  setConnectorToolEnabledInputSchema,
} from "../schemas/library";
import { authed } from "./base";

// Connectors (184): one user's view of the MCP servers they can use, merged
// from the operator's catalog (app.config.yaml) and their library, and the
// switch that turns each on or off for them. Connecting and disconnecting
// OAuth stay on the `mcp` group (`/mcp/{id}/oauth`).
//
// Tools (188): each connector's tools switch on and off too. Every read and
// write takes an optional `conversationId`: without it, the user's defaults;
// with it, that chat's choices, layered on the defaults until reset.

export const connectors = {
  list: authed
    .route({
      description:
        "The caller's connectors: the operator's catalog and the MCP servers they own or were shared, each with whether it's on and whether they may change that.",
      method: "GET",
      path: "/connectors",
      summary: "List connectors",
    })
    .input(listConnectorsInputSchema)
    .output(connectorListSchema),
  resetConversation: authed
    .route({
      description:
        "Forgets the caller's connector and tool choices for one chat, so it follows their defaults again.",
      method: "DELETE",
      path: "/conversations/{conversationId}/connectors",
      successStatus: 204,
      summary: "Reset a chat's connectors to my defaults",
    })
    .input(resetConversationConnectorsInputSchema)
    .output(z.void()),
  setEnabled: authed
    .route({
      description:
        "Turns a connector on or off for the caller, or with `conversationId` for that chat only. FORBIDDEN when the operator locked it; NOT_FOUND when the caller can't use it.",
      method: "PUT",
      path: "/connectors/{id}/enabled",
      summary: "Turn a connector on or off",
    })
    .input(setConnectorEnabledInputSchema)
    .output(connectorSchema),
  setToolEnabled: authed
    .route({
      description:
        "Turns one of a connector's tools on or off for the caller, or with `conversationId` for that chat only. FORBIDDEN when the operator requires the tool or locked the connector; NOT_FOUND when the caller can't use the connector.",
      method: "PUT",
      path: "/connectors/{id}/tools/{tool}/enabled",
      summary: "Turn a connector's tool on or off",
    })
    .input(setConnectorToolEnabledInputSchema)
    .output(connectorToolSchema),
  tools: authed
    .route({
      description:
        "A connector's tools from the server's `tools/list` (cached per connection), less those the operator denies, each with whether it's on for the caller (or that chat).",
      method: "GET",
      path: "/connectors/{id}/tools",
      summary: "List a connector's tools",
    })
    .input(listConnectorToolsInputSchema)
    .output(connectorToolListSchema),
};

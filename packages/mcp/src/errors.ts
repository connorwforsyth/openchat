import type { McpToolError } from "@workspace/ai/tools/tool-set";
import type { McpConnectionStatus } from "@workspace/contract/schemas/library";
import { z } from "zod";

// What can go wrong between us and an MCP server, as values (D8). Messages
// are for people (the builder's status line, a skipped-tool note); they
// never carry a secret, a token or a response body.

export const mcpErrorSchema = z.discriminatedUnion("type", [
  z.object({ serverId: z.string(), type: z.literal("not_found") }),
  /** stdio servers run on the desktop app (Desktop wave), never here. */
  z.object({ message: z.string(), type: z.literal("unsupported_transport") }),
  /** A URL the server may not fetch (private network, bad scheme). */
  z.object({ message: z.string(), type: z.literal("blocked_url") }),
  /** OAuth server the caller hasn't authorised (or whose grant lapsed). */
  z.object({ type: z.literal("needs_auth") }),
  /** A secret is needed but can't be read (no ENCRYPTION_KEY, rotated away). */
  z.object({ message: z.string(), type: z.literal("secrets_unavailable") }),
  /** Can't connect, timed out, backing off, rate limited. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
  /** OAuth isn't set up on this instance (no callback URL). */
  z.object({ message: z.string(), type: z.literal("oauth_unavailable") }),
  /** Discovery, registration, the callback or the code exchange failed. */
  z.object({ message: z.string(), type: z.literal("oauth_failed") }),
  /** The operation doesn't apply to this server (OAuth on a header-auth server). */
  z.object({ message: z.string(), type: z.literal("invalid_request") }),
]);
export type McpError = z.infer<typeof mcpErrorSchema>;

export const unavailable = (message: string): McpError => ({
  message,
  type: "unavailable",
});

export const describeError = (error: McpError): string => {
  switch (error.type) {
    case "not_found":
      return "This MCP server doesn't exist.";
    case "needs_auth":
      return "Sign in to this MCP server to use it.";
    case "blocked_url":
    case "invalid_request":
    case "oauth_failed":
    case "oauth_unavailable":
    case "secrets_unavailable":
    case "unavailable":
    case "unsupported_transport":
      return error.message;
    default:
      return error satisfies never;
  }
};

/** For `buildToolSet`: a server that needs sign-in is `unauthorized`, anything else `unavailable`. */
export const toToolError = (error: McpError): McpToolError => ({
  message: describeError(error),
  type: error.type === "needs_auth" ? "unauthorized" : "unavailable",
});

/** The contract's connection status for a failure. */
export const toStatus = (error: McpError): McpConnectionStatus => {
  switch (error.type) {
    case "needs_auth":
      return { state: "needs_auth" };
    // Configured, but not something this surface runs.
    case "unsupported_transport":
      return { state: "disabled" };
    default:
      return { message: describeError(error), state: "error" };
  }
};

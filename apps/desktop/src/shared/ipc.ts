import { z } from "zod";

import { instanceUrlErrorSchema } from "./instance-url";

// Everything that crosses the preload bridge (D24): channel names and zod
// schemas for each payload, parsed on both sides. Nothing here reaches the
// filesystem or a shell.

export const platformSchema = z.enum(["mac", "win", "linux"]);
export type Platform = z.infer<typeof platformSchema>;

export const platformOf = (nodePlatform: string): Platform => {
  if (nodePlatform === "darwin") {
    return "mac";
  }
  return nodePlatform === "win32" ? "win" : "linux";
};

/**
 * Commands the native menu sends to the page. Empty until the menus come
 * from the shortcut registry (117); the channel and the parsing are here so
 * the bridge doesn't change shape then.
 */
export const menuCommandSchema = z.enum([
  "new-chat",
  "open-palette",
  "toggle-sidebar",
]);
export type MenuCommand = z.infer<typeof menuCommandSchema>;

/** Added to the user agent of the instance's pages, so the web app can tell it's in the shell. */
export const USER_AGENT_TOKEN = "DesktopShell";

export const channels = {
  /** main → instance page: a `MenuCommand`. */
  menuCommand: "desktop:menu-command",
  /** setup page → main: an instance URL to check and connect to. */
  setupConnect: "setup:connect",
  /** setup page → main: the instance currently connected, if any. */
  setupCurrent: "setup:current",
} as const;

export const connectInputSchema = z.object({ url: z.string().max(2048) });
export type ConnectInput = z.infer<typeof connectInputSchema>;

export const connectErrorSchema = z.union([
  instanceUrlErrorSchema,
  z.enum(["unreachable", "not-an-instance"]),
]);
export type ConnectError = z.infer<typeof connectErrorSchema>;

export const connectResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({ name: z.string(), origin: z.url() }),
  }),
  z.object({ error: connectErrorSchema, ok: z.literal(false) }),
]);
export type ConnectResult = z.infer<typeof connectResultSchema>;

export const currentInstanceSchema = z.object({ origin: z.url().nullable() });
export type CurrentInstance = z.infer<typeof currentInstanceSchema>;

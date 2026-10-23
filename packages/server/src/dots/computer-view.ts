import { z } from "zod";

// Who drives a Dot's computer and where to watch it (172). Zod only, so the
// browser parses the same shape the server sends without pulling in the
// server's database code.

export const computerHolderSchema = z.enum(["user", "agent"]);
export type ComputerHolder = z.infer<typeof computerHolderSchema>;

export const computerViewSchema = z.object({
  /** Who drives it now: the Dot (`agent`) or the person watching (`user`). */
  holder: computerHolderSchema,
  /** noVNC on the sandbox preview origin (D24). Input works only for `user`. */
  url: z.url(),
});
export type ComputerView = z.infer<typeof computerViewSchema>;

/**
 * What the owner can do to the whole computer. Both stop the Dot's runs
 * first. `restart` keeps its files; `reset` wipes them for a fresh one.
 */
export const computerPowerActionSchema = z.enum(["restart", "reset"]);
export type ComputerPowerAction = z.infer<typeof computerPowerActionSchema>;

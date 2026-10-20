import { z } from "zod";

// Who drives a Dot's computer and where to watch it (172). Zod only, so the
// browser parses the same shape the server sends without pulling in the
// server's database code.

export const computerHolderSchema = z.enum(["user", "agent"]);
export type ComputerHolder = z.infer<typeof computerHolderSchema>;

export const computerViewSchema = z.object({
  /** Who drives it now: the Dot (`agent`) or the person watching (`user`). */
  holder: computerHolderSchema,
  /** noVNC on the sandbox preview origin (D24), view-only unless `view_only=0`. */
  url: z.url(),
});
export type ComputerView = z.infer<typeof computerViewSchema>;

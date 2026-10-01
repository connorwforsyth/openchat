import { z } from "zod";

// The shell's environment, parsed once at boot (AGENTS.md: every variable is
// optional). Development and tests use these; a person never needs them.
export const desktopEnvSchema = z.object({
  /** Connect to this instance on launch instead of the remembered one (`desktop:dev`). Not saved. */
  DESKTOP_INSTANCE_URL: z.string().min(1).optional(),
  /** Keep settings and the session here instead of the OS default (tests, side-by-side runs). */
  DESKTOP_USER_DATA: z.string().min(1).optional(),
  /** Set by `electron-vite dev`: the setup page's dev server. */
  ELECTRON_RENDERER_URL: z.url().optional(),
});
export type DesktopEnv = z.infer<typeof desktopEnvSchema>;

export const parseDesktopEnv = (env: NodeJS.ProcessEnv): DesktopEnv => {
  const parsed = desktopEnvSchema.safeParse(env);
  // A malformed value is ignored rather than fatal: the app boots without it.
  return parsed.success ? parsed.data : {};
};

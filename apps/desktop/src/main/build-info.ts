import { z } from "zod";

// What the build knows about itself (ticket 119): the brand it was packaged
// as and whether it looks for updates. electron.vite.config.ts writes it in
// as `__DESKTOP_BUILD__` from app.config.yaml's brand and the packaging
// environment, so a dev run shows the same name a packaged one does.

export const desktopBuildSchema = z.object({
  appId: z.string().min(1),
  /** Auto-update from GitHub Releases; off until builds are signed. */
  autoUpdate: z.boolean(),
  name: z.string().min(1),
});
export type DesktopBuild = z.infer<typeof desktopBuildSchema>;

/** A build without the define (a unit test, say) is still a usable app. */
const FALLBACK: DesktopBuild = {
  appId: "local.chat.desktop",
  autoUpdate: false,
  name: "Chat",
};

export const parseDesktopBuild = (value: unknown): DesktopBuild => {
  const parsed = desktopBuildSchema.safeParse(value);
  return parsed.success ? parsed.data : FALLBACK;
};

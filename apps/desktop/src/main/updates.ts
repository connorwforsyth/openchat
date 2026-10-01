import type { DesktopBuild } from "./build-info";

// Auto-update via GitHub Releases (ticket 119), wired but off until builds
// are signed: macOS won't apply an update to an unsigned app. Off means the
// updater isn't even loaded, so it makes no network call. On, it reads the
// feed electron-builder wrote (app-update.yml, from DESKTOP_UPDATE_REPO),
// downloads in the background and installs on the next quit.

export type UpdateState =
  | { readonly kind: "off"; readonly reason: "build" | "unpackaged" }
  | { readonly kind: "checking" };

/** Whether this run looks for updates; pure, so the rule is tested. */
export const updateState = (
  build: Pick<DesktopBuild, "autoUpdate">,
  isPackaged: boolean
): UpdateState => {
  if (!build.autoUpdate) {
    return { kind: "off", reason: "build" };
  }
  // A dev run has no app-update.yml and nothing to replace.
  if (!isPackaged) {
    return { kind: "off", reason: "unpackaged" };
  }
  return { kind: "checking" };
};

export const startAutoUpdate = async (
  build: Pick<DesktopBuild, "autoUpdate">,
  isPackaged: boolean
): Promise<UpdateState> => {
  const state = updateState(build, isPackaged);
  if (state.kind === "off") {
    return state;
  }
  const { autoUpdater } = await import("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (cause) => {
    // An offline machine or a missing release isn't worth a dialog.
    console.error("[desktop] update check failed:", cause.message);
  });
  autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  return state;
};

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import {
  manualCheckOutcome,
  nextUpdateState,
  type UpdateEvent,
  type UpdateState,
} from "../shared/update-state";
import type { DesktopBuild } from "./build-info";

// Auto-update via GitHub Releases (ticket 119), wired but off until builds
// are signed: macOS won't apply an update to an unsigned app. Off means the
// updater isn't even loaded, so it makes no network call. On, it reads the
// feed electron-builder wrote (app-update.yml, from DESKTOP_UPDATE_REPO),
// or `DESKTOP_UPDATE_URL` (any generic feed, for testing against a local
// one), and downloads in the background. Where that stands is an
// `UpdateState` (149): the menu shows it and offers the restart.

export type { UpdateState } from "../shared/update-state";

/** How often a running app looks again, after the check at launch. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

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
  return { kind: "idle" };
};

export interface Updates {
  /** Looks now; `manual` when the person asked (the menu item). */
  readonly check: (manual: boolean) => void;
  /** Quits and installs a downloaded update. */
  readonly restart: () => void;
  readonly state: () => UpdateState;
}

export const startAutoUpdate = async ({
  build,
  feedUrl,
  isPackaged,
  onChange,
}: {
  readonly build: Pick<DesktopBuild, "autoUpdate">;
  readonly feedUrl?: string;
  readonly isPackaged: boolean;
  readonly onChange: (next: UpdateState, previous: UpdateState) => void;
}): Promise<Updates> => {
  let state = updateState(build, isPackaged);
  if (state.kind === "off") {
    const off = state;
    return {
      check: () => undefined,
      restart: () => undefined,
      state: () => off,
    };
  }
  const apply = (event: UpdateEvent) => {
    const previous = state;
    state = nextUpdateState(state, event);
    if (state !== previous) {
      onChange(state, previous);
    }
  };

  const { autoUpdater } = await import("electron-updater");
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  }
  autoUpdater.autoDownload = true;
  // A download the person never restarts for still lands on the next quit.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) =>
    apply({ type: "available", version: info.version })
  );
  autoUpdater.on("update-not-available", () =>
    apply({ type: "not-available" })
  );
  autoUpdater.on("download-progress", (progress) =>
    apply({ percent: progress.percent, type: "progress" })
  );
  autoUpdater.on("update-downloaded", (info) =>
    apply({ type: "downloaded", version: info.version })
  );
  autoUpdater.on("error", (cause) => {
    // An offline machine or a missing release isn't worth a dialog unless
    // the person asked (main decides, from the state).
    console.error("[desktop] update check failed:", cause.message);
    apply({ message: cause.message, type: "error" });
  });

  const check = (manual: boolean) => {
    apply({ manual, type: "check" });
    // Failures arrive as "error" events too.
    autoUpdater.checkForUpdates().catch(() => undefined);
  };
  check(false);
  setInterval(() => check(false), RECHECK_MS).unref();

  return {
    check,
    restart: () => {
      if (state.kind === "downloaded") {
        autoUpdater.quitAndInstall();
      }
    },
    state: () => state,
  };
};

/**
 * The dialog for a check the person asked for that found nothing to install
 * (an update found shows in the menu instead), or none.
 */
export const manualCheckMessage = (
  previous: UpdateState,
  next: UpdateState,
  {
    appName,
    i18n,
    version,
  }: { readonly appName: string; readonly i18n: I18n; readonly version: string }
): { readonly message: string; readonly detail: string } | null => {
  switch (manualCheckOutcome(previous, next)) {
    case "up-to-date":
      return {
        detail: i18n._(msg`${appName} ${version} is the newest version.`),
        message: i18n._(msg`You're up to date`),
      };
    case "failed":
      return {
        detail: i18n._(msg`Check your connection and try again.`),
        message: i18n._(msg`Couldn't check for updates`),
      };
    default:
      return null;
  }
};

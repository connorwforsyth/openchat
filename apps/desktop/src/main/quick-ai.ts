import { BrowserWindow, type Rectangle, screen } from "electron";

import type { Platform } from "../shared/ipc";
import { decideQuickNavigation, mainUrlFor, quickUrl } from "../shared/quick";
import {
  placeQuickWindow,
  QUICK_WINDOW,
  quickHeight,
  quickWindowLook,
} from "./quick-window";
import { guardContents, type OriginSource } from "./security";

// The Quick AI window (118): a small, frameless, always-on-top window over
// whatever the person is doing, showing the instance's `/quick` page (the
// composer, then a compact reply). It's made on first use and then hidden
// rather than closed, so it opens at once after that and a reply keeps
// streaming while it's out of sight. Escape (the page asks, through the
// bridge) or clicking elsewhere hides it. The page itself is the web app's;
// this is only the window around it. Its rules are pure functions in
// src/shared/quick.ts and src/main/quick-window.ts.

export interface QuickAiPorts {
  readonly openExternal: (url: string) => void;
  /** Shows an instance URL in the main window (a chat after ⌘⏎, sign-in). */
  readonly openInMain: (url: string) => void;
  readonly origin: OriginSource;
  readonly platform: Platform;
  /** The hardened preferences every instance window gets (D24). */
  readonly webPreferences: Electron.WebPreferences;
}

export interface QuickAi {
  /** Closes the window for good (a new instance, or quitting). */
  readonly destroy: () => void;
  readonly hide: () => void;
  readonly show: () => void;
  /** Shows the window, or hides it when it's already in front. */
  readonly toggle: () => void;
  readonly window: () => BrowserWindow | null;
}

/** The display the person is using: the one under the pointer. */
const activeWorkArea = (): Rectangle =>
  screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

export const createQuickAi = (ports: QuickAiPorts): QuickAi => {
  let window: BrowserWindow | null = null;
  let workArea = activeWorkArea();
  // Showing waits for the first paint; the page may also have left
  // `/quick` (signed out), and then the next show loads it again.
  let ready = false;
  let wanted = false;
  let stale = false;
  let closing = false;

  /** Sets the window's height, keeping its top where it is. */
  const setHeight = (current: BrowserWindow, height: number) => {
    const { width, x, y } = current.getBounds();
    current.setBounds({ height: quickHeight(height, workArea), width, x, y });
  };

  const hide = () => {
    wanted = false;
    if (window && !window.isDestroyed() && window.isVisible()) {
      window.hide();
      // Chromium's preferred height is never less than the window's, so
      // a window that grew for a long reply would stay that tall. Shrunk
      // while hidden, the page measures itself afresh before it's next
      // shown.
      setHeight(window, 0);
    }
  };

  const reveal = (current: BrowserWindow) => {
    current.show();
    current.focus();
    current.webContents.focus();
  };

  const create = (origin: string): BrowserWindow => {
    const created = new BrowserWindow({
      ...placeQuickWindow(workArea),
      alwaysOnTop: true,
      frame: false,
      fullscreenable: false,
      // As short as it gets: the page's preferred height grows it.
      height: QUICK_WINDOW.minHeight,
      maximizable: false,
      minimizable: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      title: "",
      // macOS: a translucent panel over full-screen apps and every Space.
      ...quickWindowLook(ports.platform),
      webPreferences: {
        ...ports.webPreferences,
        // Reports the page's height, which the window follows.
        enablePreferredSizeMode: true,
      },
    });
    created.setAlwaysOnTop(true, "floating");
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    guardContents(
      created.webContents,
      ports.origin,
      {
        openExternal: ports.openExternal,
        // A chat (⌘⏎) or sign-in: the main window's job. This window goes
        // back to `/quick` the next time it opens.
        openInMain: (url) => {
          stale = true;
          hide();
          ports.openInMain(mainUrlFor(url));
        },
      },
      decideQuickNavigation
    );
    created.webContents.on("preferred-size-changed", (_event, size) => {
      setHeight(created, size.height);
    });
    created.once("ready-to-show", () => {
      ready = true;
      if (wanted) {
        reveal(created);
      }
    });
    created.webContents.on(
      "did-fail-load",
      (_event, code, _description, _url, isMainFrame) => {
        // -3: a navigation the window itself stopped (sent elsewhere).
        if (isMainFrame && code !== -3) {
          stale = true;
          hide();
        }
      }
    );
    // ⌘W and the like hide it too, so the window (and a reply still
    // streaming) is there next time. Quitting destroys it first.
    created.on("close", (event) => {
      if (!closing) {
        event.preventDefault();
        hide();
      }
    });
    created.on("blur", hide);
    created.on("closed", () => {
      if (window === created) {
        window = null;
        ready = false;
      }
    });
    created.loadURL(quickUrl(origin)).catch(() => undefined);
    return created;
  };

  const show = () => {
    const origin = ports.origin();
    if (!origin) {
      return;
    }
    workArea = activeWorkArea();
    wanted = true;
    if (window && stale) {
      const reloading = window;
      stale = false;
      ready = false;
      reloading.webContents.once("did-finish-load", () => {
        ready = true;
        if (wanted) {
          reveal(reloading);
        }
      });
      reloading.loadURL(quickUrl(origin)).catch(() => undefined);
    }
    const current = window ?? create(origin);
    window = current;
    // On the display in use, at the height the page last asked for.
    current.setBounds({
      ...placeQuickWindow(workArea),
      height: quickHeight(current.getBounds().height, workArea),
    });
    if (ready) {
      reveal(current);
    }
  };

  const destroy = () => {
    closing = true;
    window?.destroy();
    window = null;
    ready = false;
    stale = false;
    closing = false;
  };

  return {
    destroy,
    hide,
    show,
    toggle: () => {
      if (window?.isVisible() && window.isFocused()) {
        hide();
      } else {
        show();
      }
    },
    window: () => window,
  };
};

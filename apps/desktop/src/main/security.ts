import type { Session, WebContents } from "electron";
import { USER_AGENT_TOKEN } from "../shared/ipc";
import { decideNavigation, decidePermission } from "../shared/navigation";

// D24 for the shell. Every window is sandboxed with context isolation and no
// Node (src/main/windows.ts); these hooks keep each one on its own content.

/** Which instance a window belongs to, read when a decision is made (it can change). */
export type OriginSource = () => string | null;

export interface SecurityPorts {
  /** Opens a URL in the system browser (`shell.openExternal`). */
  readonly openExternal: (url: string) => void;
  /** Shows a same-origin `window.open` in the main window instead of a new one. */
  readonly openInMain: (url: string) => void;
}

/**
 * Locks a window's top-level navigation to its instance: other http(s) and
 * mailto links open in the system browser, anything else is dropped.
 * Subframes (artifact and preview iframes, D24) are the web app's business:
 * they're sandboxed there and never get the bridge.
 */
export const guardContents = (
  contents: WebContents,
  origin: OriginSource,
  ports: SecurityPorts
) => {
  const route = (
    url: string,
    event: { readonly preventDefault: () => void }
  ) => {
    const decision = decideNavigation(url, origin());
    if (decision === "allow") {
      return;
    }
    event.preventDefault();
    if (decision === "external") {
      ports.openExternal(url);
    }
  };
  contents.on("will-navigate", (event) => route(event.url, event));
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame) {
      route(event.url, event);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, origin());
    if (decision === "allow") {
      ports.openInMain(url);
    } else if (decision === "external") {
      ports.openExternal(url);
    }
    return { action: "deny" };
  });
};

/** Defaults for anything created before a window attaches its own guard. */
export const guardEveryContents = (contents: WebContents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
};

/**
 * Permissions are denied unless the instance asks for one of the few it may
 * use (src/shared/navigation.ts). No USB, HID or serial devices at all.
 */
export const guardSession = (session: Session, origin: OriginSource) => {
  session.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      callback(decidePermission(permission, details.requestingUrl, origin()));
    }
  );
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    decidePermission(permission, requestingOrigin, origin())
  );
  session.setDevicePermissionHandler(() => false);
};

/** Marks the instance's requests as the shell's, so the web app can adapt (117). */
export const markUserAgent = (session: Session, version: string) => {
  session.setUserAgent(
    `${session.getUserAgent()} ${USER_AGENT_TOKEN}/${version}`
  );
};

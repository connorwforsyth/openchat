// The desktop app (116) adds `DesktopShell/<version>` to its windows' user
// agent so the web app can tell it's inside the shell.
const SHELL_TOKEN = /\bDesktopShell\/\S+/;
const MAC = /\bMacintosh\b/;

/**
 * Whether a page is shown by the desktop app on macOS, where the Quick AI
 * window puts a native translucent material behind the page (135). Elsewhere
 * there's nothing behind it, so the page keeps its own background. Pure.
 */
export const hasNativeMaterial = (userAgent: string | null): boolean =>
  userAgent !== null && SHELL_TOKEN.test(userAgent) && MAC.test(userAgent);

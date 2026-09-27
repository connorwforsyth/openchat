// D28's inline app shell: the sidebar's collapsed state is restored from
// `localStorage` before the first paint, so a collapsed sidebar never flashes
// open while React hydrates. The server can't know it (it's per browser), so
// it renders the default (open) and an inline script marks `<html>` before
// the shell's markup is parsed; `shell.css` hides the sidebar from that mark.
// Once the app has read the same layout, it keeps the mark in step.

/** Where chat-ui's `useShellLayout` keeps the layout. */
export const SHELL_LAYOUT_KEY = "chat-ui:layout";

/** On `<html>`: `data-sidebar="closed"` while the sidebar is collapsed. */
export const SIDEBAR_ATTRIBUTE = "data-sidebar";

/**
 * Runs inline, before paint, so: no imports, no modules, and nothing that can
 * throw past the `try` (blocked storage, bad JSON).
 */
export const shellPrepaintScript = `(function(){try{var l=JSON.parse(localStorage.getItem(${JSON.stringify(
  SHELL_LAYOUT_KEY
)})||"null");if(l&&l.sidebarOpen===false){document.documentElement.setAttribute(${JSON.stringify(
  SIDEBAR_ATTRIBUTE
)},"closed")}}catch(e){}})()`;

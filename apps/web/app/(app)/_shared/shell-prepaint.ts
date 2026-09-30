import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_VAR,
} from "@workspace/chat-ui/model/layout";

// D28's inline app shell: the sidebar's collapsed state and width are
// restored from `localStorage` before the first paint, so a collapsed sidebar
// never flashes open, and a resized one never jumps, while React hydrates.
// The server can't know them (they're per browser), so it renders the
// default (open, 260px) and an inline script marks `<html>` before the
// shell's markup is parsed: `shell.css` hides the sidebar from the mark, and
// the shell sizes it from the width variable. Once the app has read the same
// layout, it keeps both in step.

/** Where chat-ui's `useShellLayout` keeps the layout. */
export const SHELL_LAYOUT_KEY = "chat-ui:layout";

/** On `<html>`: `data-sidebar="closed"` while the sidebar is collapsed. */
export const SIDEBAR_ATTRIBUTE = "data-sidebar";

/**
 * Runs inline, before paint, so: no imports, no modules, and nothing that can
 * throw past the `try` (blocked storage, bad JSON, a width that isn't one).
 */
export const shellPrepaintScript = `(function(){try{var d=document.documentElement;var l=JSON.parse(localStorage.getItem(${JSON.stringify(
  SHELL_LAYOUT_KEY
)})||"null");if(l&&l.sidebarOpen===false){d.setAttribute(${JSON.stringify(
  SIDEBAR_ATTRIBUTE
)},"closed")}var w=Math.round(Number(localStorage.getItem(${JSON.stringify(
  SIDEBAR_WIDTH_STORAGE_KEY
)})));if(w>=${SIDEBAR_MIN_WIDTH}&&w<=${SIDEBAR_MAX_WIDTH}){d.style.setProperty(${JSON.stringify(
  SIDEBAR_WIDTH_VAR
)},w+"px")}}catch(e){}})()`;

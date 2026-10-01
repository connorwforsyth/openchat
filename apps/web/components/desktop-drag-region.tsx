"use client";

import { useDesktopPlatform } from "@workspace/shortcuts/react/use-desktop";

// Pages outside the app shell (sign-in, sign-up, invitations) have no header
// to drag the desktop app's title-bar-less window by (117), so on macOS a
// strip along the top does it. Nothing on those pages sits up there. Renders
// nothing in a browser.
export function DesktopDragRegion() {
  if (useDesktopPlatform() !== "mac") {
    return null;
  }
  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 h-10 select-none [-webkit-app-region:drag] [app-region:drag]"
      data-slot="desktop-drag-region"
    />
  );
}

import { initLingui } from "@workspace/i18n/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppFrame } from "@/app/(app)/_shared/app-frame";
import { BadConfigNotice } from "@/app/(app)/_shared/unavailable";
import { hasNativeMaterial } from "@/lib/desktop-shell";
import { requestLocale } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/public-config";
import { routes } from "@/lib/routes";
import { getViewer } from "@/lib/server-session";

// Quick AI (118): the desktop app's floating window shows `/quick`, the
// composer and a compact reply. It's signed in like every app page (the
// proxy and this check, as in the (app) layout), with the same frame (the
// API client and the query cache), but none of the app's chrome: no shell
// layout, palette or global shortcuts, which would navigate a window that
// only ever shows this page.
//
// The window is a strip (135): it's exactly as tall as the page, so the
// page never scrolls and never shows a scrollbar. On macOS the desktop app
// puts native vibrancy behind it, so the page's own background goes; in a
// browser, or the app elsewhere, it keeps it.

/**
 * No scrollbar anywhere: not the page's (a display too short for the
 * window), the input's, the reply's or a code block's in it. They all still
 * scroll.
 */
const NO_PAGE_SCROLLBAR = "*{scrollbar-width:none}";
/**
 * The native material shows through. The colour scheme is the page's own
 * (the theme's tokens), so the canvas mustn't take one from it.
 */
const SEE_THROUGH =
  "html,body{background:transparent!important;color-scheme:normal!important}";

export default async function QuickLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  initLingui(await requestLocale());
  const [config, viewer, request] = await Promise.all([
    getPublicConfig(),
    getViewer(),
    headers(),
  ]);
  if (!config.ok) {
    return <BadConfigNotice />;
  }
  if (viewer.kind === "signed_out") {
    redirect(routes.signIn);
  }
  const pageCss = hasNativeMaterial(request.get("user-agent"))
    ? `${NO_PAGE_SCROLLBAR}${SEE_THROUGH}`
    : NO_PAGE_SCROLLBAR;
  return (
    <>
      <style>{pageCss}</style>
      <AppFrame
        config={config.config}
        initialMe={viewer.kind === "signed_in" ? viewer.me : null}
        surfaces={false}
      >
        {children}
      </AppFrame>
    </>
  );
}

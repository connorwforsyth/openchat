import { initLingui } from "@workspace/i18n/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppFrame } from "@/app/(app)/_shared/app-frame";
import { BadConfigNotice } from "@/app/(app)/_shared/unavailable";
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

export default async function QuickLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  initLingui(await requestLocale());
  const [config, viewer] = await Promise.all([getPublicConfig(), getViewer()]);
  if (!config.ok) {
    return <BadConfigNotice />;
  }
  if (viewer.kind === "signed_out") {
    redirect(routes.signIn);
  }
  return (
    <AppFrame
      config={config.config}
      initialMe={viewer.kind === "signed_in" ? viewer.me : null}
      surfaces={false}
    >
      {children}
    </AppFrame>
  );
}

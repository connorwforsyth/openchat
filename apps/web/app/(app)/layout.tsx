import { initLingui } from "@workspace/i18n/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requestLocale } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/public-config";
import { routes } from "@/lib/routes";
import { getViewer } from "@/lib/server-session";

import { AppFrame } from "./_shared/app-frame";
import { shellPrepaintScript } from "./_shared/shell-prepaint";
import { BadConfigNotice } from "./_shared/unavailable";
import "./shell.css";

// Every signed-in page: chat, library, settings, admin. The proxy has already
// sent visitors without a session cookie to sign-in; this asks the API who
// the cookie belongs to (a stale one also goes to sign-in) and inlines that
// and the public config, so the first render needs no round trip (D27). The
// API checks the session again on every call: this is about showing the right
// page, not about security.

export default async function SignedInLayout({
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
    <>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant written in this repo, not user input; it has to run before paint (D28).
        dangerouslySetInnerHTML={{ __html: shellPrepaintScript }}
      />
      <AppFrame
        config={config.config}
        initialMe={viewer.kind === "signed_in" ? viewer.me : null}
      >
        {children}
      </AppFrame>
    </>
  );
}

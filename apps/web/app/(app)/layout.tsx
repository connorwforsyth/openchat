import { initLingui } from "@workspace/i18n/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requestLocale } from "@/lib/i18n";

import { AppProviders } from "./_shared/providers";
import { routes } from "./_shared/routes";
import { getViewer } from "./_shared/session";
import { UnavailableNotice } from "./_shared/unavailable";

// Signed-in pages (settings and admin for now). The session is checked on the
// server; the API checks it again on every call, so this is about showing
// the right page, not about security. 025 replaces this with 015's AppShell.

export default async function SignedInLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  initLingui(await requestLocale());
  const viewer = await getViewer();
  switch (viewer.kind) {
    case "unavailable":
      return <UnavailableNotice reason={viewer.reason} />;
    case "signed_out":
      redirect(routes.signIn);
      break;
    case "signed_in":
      return <AppProviders userId={viewer.userId}>{children}</AppProviders>;
    default:
      return viewer satisfies never;
  }
}

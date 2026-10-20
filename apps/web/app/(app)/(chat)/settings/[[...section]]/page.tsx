import { notFound, redirect } from "next/navigation";

import {
  settingsRedirect,
  settingsRouteFromPath,
} from "@/app/(app)/_shared/settings/settings-route";
import { requestLocale } from "@/lib/i18n";
import { getTerms } from "@/lib/terms";

// Settings is a full-screen view over the page you're on (185). Loaded from
// its address, the page underneath is the new chat (this sits in the chat
// layout) and settings opens over it; the global surfaces read the section from the URL.
// A section's segment is its configured slug (191): an old one redirects,
// an unknown one is a 404.
export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ section?: string[] }>;
}) {
  const parts = (await params).section ?? [];
  const pathname = ["/settings", ...parts].join("/");
  const terms = await getTerms(await requestLocale());
  const moved = settingsRedirect(pathname, terms);
  if (moved) {
    redirect(moved);
  }
  if (settingsRouteFromPath(pathname, terms) === null) {
    notFound();
  }
  return null;
}

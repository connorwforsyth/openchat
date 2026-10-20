import { notFound } from "next/navigation";

import { settingsRouteFromPath } from "@/app/(app)/_shared/settings/settings-route";

// Settings is a dialog over the page you're on (185). Loaded from its address,
// the page underneath is the new chat (this sits in the chat layout) and the
// dialog opens over it; the global surfaces read the section from the URL.
// An unknown section is a 404.
export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ section?: string[] }>;
}) {
  const parts = (await params).section ?? [];
  if (settingsRouteFromPath(["/settings", ...parts].join("/")) === null) {
    notFound();
  }
  return null;
}

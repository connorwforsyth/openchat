import { initLingui } from "@workspace/i18n/server";

import { requestLocale } from "@/lib/i18n";

import { CustomizeScreen } from "../customize-screen";

// `/customize`, `/customize/<kind>`, `/customize/<kind>/<id>[/manage]`
// (193). The client reads the segments with the configured terms.
export default async function Page({
  params,
}: {
  readonly params: Promise<{ path?: string[] }>;
}) {
  initLingui(await requestLocale());
  const { path = [] } = await params;
  return <CustomizeScreen segments={path} />;
}

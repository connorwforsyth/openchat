import { initLingui } from "@workspace/i18n/server";

import { requestLocale } from "@/lib/i18n";

import { SpaceHome } from "./space-home";

export default async function Page() {
  initLingui(await requestLocale());
  return <SpaceHome />;
}

import { initLingui } from "@workspace/i18n/server";

import { requestLocale } from "@/lib/i18n";

import { SchedulesScreen } from "./schedules-screen";

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());
  return <SchedulesScreen />;
}

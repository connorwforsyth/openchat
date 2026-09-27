import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";

import { requestLocale } from "@/lib/i18n";

import { PageHeader } from "../../_shared/section-nav";
import { AppearanceSettings } from "../_components/appearance-settings";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader
        description={<Trans>How the app looks on this device.</Trans>}
        title={<Trans>Appearance</Trans>}
      />
      <AppearanceSettings />
    </>
  );
}

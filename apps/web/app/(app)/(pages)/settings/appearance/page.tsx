import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { PageHeader } from "@/app/(app)/_shared/section-nav";
import { requestLocale } from "@/lib/i18n";
import { AppearanceSettings } from "../_components/appearance-settings";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader
        description={<Trans>How the app looks.</Trans>}
        title={<Trans>Appearance</Trans>}
      />
      <AppearanceSettings />
    </>
  );
}

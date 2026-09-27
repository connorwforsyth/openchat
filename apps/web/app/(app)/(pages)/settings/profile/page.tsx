import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { PageHeader } from "@/app/(app)/_shared/section-nav";
import { requestLocale } from "@/lib/i18n";
import { ProfileSettings } from "../_components/profile-settings";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader title={<Trans>Profile and language</Trans>} />
      <ProfileSettings />
    </>
  );
}

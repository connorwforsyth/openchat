import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { PageHeader } from "@/app/(app)/_shared/section-nav";
import { requestLocale } from "@/lib/i18n";
import { PersonalKeys } from "../_components/personal-keys";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader
        description={
          <Trans>
            Your own keys pay for your Personal chats, and for team or org chats
            when the org allows it.
          </Trans>
        }
        title={<Trans>Provider keys</Trans>}
      />
      <PersonalKeys />
    </>
  );
}

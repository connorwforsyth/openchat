import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { PageHeader } from "@/app/(app)/_shared/section-nav";
import { requestLocale } from "@/lib/i18n";
import { ConnectorsSettings } from "../_components/connectors-settings";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader
        description={
          <Trans>
            MCP servers give chats extra tools. Turn on the ones you want; your
            administrator may require some or let you add your own.
          </Trans>
        }
        title={<Trans>Connectors</Trans>}
      />
      <ConnectorsSettings />
    </>
  );
}

import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";

import { requestLocale } from "@/lib/i18n";

import { PageHeader } from "../../_shared/section-nav";
import { MemorySettings } from "../_components/memory-settings";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader
        description={
          <Trans>What agents remember about you across chats.</Trans>
        }
        title={<Trans>Memory</Trans>}
      />
      <MemorySettings />
    </>
  );
}

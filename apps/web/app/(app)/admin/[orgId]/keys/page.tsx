import { Trans } from "@lingui/react/macro";
import { orgIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";

import { requestLocale } from "@/lib/i18n";

import { PageHeader } from "../../../_shared/section-nav";
import { OrgKeysAdmin } from "../../_components/org-keys-admin";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  initLingui(await requestLocale());
  const orgId = orgIdSchema.safeParse((await params).orgId);
  if (!orgId.success) {
    notFound();
  }
  return (
    <>
      <PageHeader
        description={
          <Trans>
            Provider keys that pay for this org's chats. Secrets are never shown
            again after you add them.
          </Trans>
        }
        title={<Trans>Org and team keys</Trans>}
      />
      <OrgKeysAdmin orgId={orgId.data} />
    </>
  );
}

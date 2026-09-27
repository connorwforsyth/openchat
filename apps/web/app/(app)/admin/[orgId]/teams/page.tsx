import { Trans } from "@lingui/react/macro";
import { orgIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";

import { requestLocale } from "@/lib/i18n";

import { PageHeader } from "../../../_shared/section-nav";
import { TeamsAdmin } from "../../_components/teams-admin";

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
            Access given to a team flows to its sub-teams; usage rolls up.
          </Trans>
        }
        title={<Trans>Teams</Trans>}
      />
      <TeamsAdmin orgId={orgId.data} />
    </>
  );
}

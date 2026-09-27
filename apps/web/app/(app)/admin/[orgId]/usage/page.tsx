import { Trans } from "@lingui/react/macro";
import { orgIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";

import { requestLocale } from "@/lib/i18n";

import { PageHeader } from "../../../_shared/section-nav";
import { UsageAdmin } from "../../_components/usage-admin";

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
        description={<Trans>What this org spends, and the limits on it.</Trans>}
        title={<Trans>Budgets and usage</Trans>}
      />
      <UsageAdmin orgId={orgId.data} />
    </>
  );
}

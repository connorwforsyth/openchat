import { Trans } from "@lingui/react/macro";
import { orgIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";

import { requestLocale } from "@/lib/i18n";

import { PageHeader } from "../../../_shared/section-nav";
import { AuditPolicy } from "../../_components/audit-policy";

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
            Off unless an owner turns it on. Admins see usage and metadata
            either way, never chat content.
          </Trans>
        }
        title={<Trans>Audit policy</Trans>}
      />
      <AuditPolicy orgId={orgId.data} />
    </>
  );
}

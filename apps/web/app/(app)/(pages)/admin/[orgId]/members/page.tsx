import { Trans } from "@lingui/react/macro";
import { orgIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/(app)/_shared/section-nav";
import { requestLocale } from "@/lib/i18n";
import { MembersAdmin } from "../../_components/members-admin";

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
        description={<Trans>Who's in this org and what they can manage.</Trans>}
        title={<Trans>Members and invitations</Trans>}
      />
      <MembersAdmin orgId={orgId.data} />
    </>
  );
}

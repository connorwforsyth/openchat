import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { PageHeader } from "@/app/(app)/_shared/section-nav";
import { requestLocale } from "@/lib/i18n";
import { AdminIndex } from "./_components/admin-index";

export default async function AdminPage() {
  initLingui(await requestLocale());
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-8">
      <PageHeader
        description={<Trans>Orgs you own or administer.</Trans>}
        title={<Trans>Admin</Trans>}
      />
      <AdminIndex />
    </div>
  );
}

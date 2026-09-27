import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { orgIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import {
  EyeIcon,
  KeyRoundIcon,
  NetworkIcon,
  ShieldIcon,
  UsersIcon,
  WalletIcon,
} from "@workspace/icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SectionLayout } from "@/app/(app)/_shared/section-layout";
import { requestLocale } from "@/lib/i18n";

import { routes } from "@/lib/routes";
import { getViewer } from "@/lib/server-session";
import { OrgName } from "../_components/admin-index";

// One org's admin pages, for its owners and admins only. The role is checked
// here on the server (so others get a 404, not a page of failing calls) and
// again by every API call.

export default async function OrgAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ orgId: string }>;
}) {
  const i18n = initLingui(await requestLocale());
  const parsed = orgIdSchema.safeParse((await params).orgId);
  if (!parsed.success) {
    notFound();
  }
  const orgId = parsed.data;
  const viewer = await getViewer();
  // The API decides on every call; this spares others a page of failing
  // calls. When the server couldn't say who's asking, the page renders and
  // the API refuses what it must.
  if (viewer.kind === "signed_in") {
    const role = viewer.me.orgs.find((org) => org.id === orgId)?.myRole;
    if (role !== "owner" && role !== "admin") {
      notFound();
    }
  }
  const section = (name: string) => routes.adminOrg(orgId, name);
  return (
    <SectionLayout
      back={
        <Link
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          href={routes.admin}
        >
          <Trans>All orgs</Trans>
        </Link>
      }
      heading={<OrgName orgId={orgId} />}
      items={[
        {
          href: section("policies"),
          icon: <ShieldIcon />,
          label: <Trans>Policies</Trans>,
        },
        {
          href: section("members"),
          icon: <UsersIcon />,
          label: <Trans>Members</Trans>,
        },
        {
          href: section("teams"),
          icon: <NetworkIcon />,
          label: <Trans>Teams</Trans>,
        },
        {
          href: section("keys"),
          icon: <KeyRoundIcon />,
          label: <Trans>Keys</Trans>,
        },
        {
          href: section("usage"),
          icon: <WalletIcon />,
          label: <Trans>Budgets and usage</Trans>,
        },
        {
          href: section("audit"),
          icon: <EyeIcon />,
          label: <Trans>Audit policy</Trans>,
        },
      ]}
      navLabel={i18n._(msg`Admin pages`)}
    >
      {children}
    </SectionLayout>
  );
}

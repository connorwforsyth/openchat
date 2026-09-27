"use client";

import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Building2Icon, ChevronRightIcon } from "@workspace/icons";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import Link from "next/link";

import { useApi } from "../../_shared/api";
import { QueryState } from "../../_shared/query-state";
import { routes } from "../../_shared/routes";

// Orgs the caller runs. The personal org never shows: it has no members,
// teams or policies to manage (D17).

export const AdminIndex = () => {
  const { query } = useApi();
  const me = useQuery(query.me.get.queryOptions());
  return (
    <QueryState query={me}>
      {(data) => {
        const managed = data.orgs.filter(
          (org) =>
            !org.isPersonal &&
            (org.myRole === "owner" || org.myRole === "admin")
        );
        return managed.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>No orgs to manage</Trans>
              </EmptyTitle>
              <EmptyDescription>
                <Trans>
                  You're not an owner or admin of any org. Admin pages appear
                  here when you are.
                </Trans>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border">
            {managed.map((org) => (
              <li key={org.id}>
                <Link
                  className="flex items-center gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  href={routes.adminOrg(org.id)}
                >
                  <Building2Icon className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {org.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {org.myRole === "owner" ? (
                      <Trans>Owner</Trans>
                    ) : (
                      <Trans>Admin</Trans>
                    )}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        );
      }}
    </QueryState>
  );
};

/** The org's name for the admin heading; the id until it loads. */
export const OrgName = ({ orgId }: { readonly orgId: string }) => {
  const { query } = useApi();
  const org = useQuery(query.orgs.get.queryOptions({ input: { id: orgId } }));
  return <>{org.data?.name ?? <Trans>Org admin</Trans>}</>;
};

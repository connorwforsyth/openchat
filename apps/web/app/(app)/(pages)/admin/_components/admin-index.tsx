"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import type { Me } from "@workspace/contract/schemas/meta";
import {
  Building2Icon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  PlusIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { useAppFrame } from "@/app/(app)/_shared/app-frame";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { routes } from "@/lib/routes";

// Orgs the caller runs. The personal org never shows: it has no members,
// teams or policies to manage (D17).

export const AdminIndex = () => {
  const { query } = useApi();
  const me = useQuery(query.me.get.queryOptions());
  return (
    <QueryState query={me}>
      {(data) => {
        const managed = managedOrgs(data);
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

/** Orgs `me` runs: owner or admin, never the personal one (D17). */
export const managedOrgs = (me: Pick<Me, "orgs">): Me["orgs"] =>
  me.orgs.filter(
    (org) =>
      !org.isPersonal && (org.myRole === "owner" || org.myRole === "admin")
  );

const SECTION = /^\/admin\/[^/]+\/([^/]+)/;

/**
 * The admin heading: this org's name, and a menu to switch to another org
 * you run (the same page there) or create one (044).
 */
export const OrgSwitcher = ({ orgId }: { readonly orgId: OrgId }) => {
  const { t } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const { query } = useApi();
  const { openNewOrg } = useAppFrame();
  const org = useQuery(query.orgs.get.queryOptions({ input: { id: orgId } }));
  const me = useQuery(query.me.get.queryOptions());
  const orgs = me.data ? managedOrgs(me.data) : [];
  const section = SECTION.exec(pathname)?.[1];
  const name = org.data?.name ?? orgs.find((each) => each.id === orgId)?.name;
  const switchTo = useCallback(
    (value: unknown) => {
      const next = orgs.find((each) => each.id === value);
      if (next && next.id !== orgId) {
        router.push(routes.adminOrg(next.id, section));
      }
    },
    [orgId, orgs, router, section]
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Organisation: ${name ?? t`Org admin`}`}
            className="-ms-2 h-auto max-w-full px-2 py-1 font-medium text-xl"
            variant="ghost"
          />
        }
      >
        <span className="truncate">{name ?? <Trans>Org admin</Trans>}</span>
        <ChevronsUpDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Organisations you run</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={switchTo} value={orgId}>
            {orgs.map((each) => (
              <DropdownMenuRadioItem key={each.id} value={each.id}>
                <Building2Icon aria-hidden />
                <span className="truncate">{each.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={openNewOrg}>
            <PlusIcon aria-hidden />
            <Trans>New organisation</Trans>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

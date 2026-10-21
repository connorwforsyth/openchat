"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { PublicConfig } from "@workspace/contract/schemas/meta";
import { BrandMark } from "@workspace/icons/brands";
import { z } from "zod";

import { useAuthClient } from "@/app/(auth)/_components/use-auth-client";

// The sign-in methods linked to this account (186): Microsoft and the other
// providers, read from Better Auth's own `list-accounts`.

const linkedAccountsSchema = z.array(
  z.object({ createdAt: z.coerce.date(), providerId: z.string() })
);
export type LinkedAccount = z.infer<typeof linkedAccountsSchema>[number];

type Provider = PublicConfig["auth"]["providers"][number];

export const ConnectedAccountsList = ({
  accounts,
  providers,
}: {
  readonly accounts: readonly LinkedAccount[];
  readonly providers: readonly Provider[];
}) => {
  const { i18n, t } = useLingui();
  const nameOf = (providerId: string): string =>
    providerId === "credential"
      ? t`Email and password`
      : (providers.find((provider) => provider.id === providerId)?.name ??
        providerId);
  return (
    <ul className="flex flex-col gap-3">
      {accounts.map((linked) => {
        const name = nameOf(linked.providerId);
        const since = i18n.date(linked.createdAt, { dateStyle: "medium" });
        return (
          <li className="flex items-center gap-3" key={linked.providerId}>
            <BrandMark brand={linked.providerId} className="size-4" />
            <span className="font-medium text-sm">{name}</span>
            <span className="text-muted-foreground text-sm">
              <Trans>Linked {since}</Trans>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export const ConnectedAccounts = ({
  providers,
}: {
  readonly providers: readonly Provider[];
}) => {
  const auth = useAuthClient();
  const accounts = useQuery({
    queryFn: async () => {
      const result = await auth.listAccounts();
      return linkedAccountsSchema.parse(result.data ?? []);
    },
    queryKey: ["auth", "accounts"],
  });
  if (!accounts.data) {
    return null;
  }
  return accounts.data.length === 0 ? (
    <p className="text-muted-foreground text-sm">
      <Trans>No sign-in methods are linked.</Trans>
    </p>
  ) : (
    <ConnectedAccountsList accounts={accounts.data} providers={providers} />
  );
};

"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Me,
  PublicConfig,
  UserSettings,
} from "@workspace/contract/schemas/meta";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { supportedLocales } from "@workspace/i18n/locales";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useApi } from "../../_shared/api";
import { type Option, OptionSelect } from "../../_shared/option-select";
import { QueryState } from "../../_shared/query-state";

// Profile & language (D12): the saved `user.locale` (null means "follow the
// browser") and the default chat context for new chats (D17). Changes apply
// to the cache first and roll back if the server refuses (D28).

const BROWSER = "browser";

/** A chat context as one string, for a Select. */
export const contextKey = (context: {
  readonly id?: string;
  readonly type: string;
}): string => (context.id ? `${context.type}:${context.id}` : "personal");

export const contextOptions = (
  me: Me,
  allowed: PublicConfig["policies"]["chatContexts"],
  labels: { readonly personal: string }
): readonly (Option<string> & { readonly context: ChatContext })[] => [
  { context: { type: "personal" }, label: labels.personal, value: "personal" },
  ...(allowed.includes("team")
    ? me.teams.map(({ team }) => ({
        context: { id: team.id, type: "team" as const },
        label: team.name,
        value: `team:${team.id}`,
      }))
    : []),
  ...(allowed.includes("org")
    ? me.orgs
        .filter((org) => !org.isPersonal)
        .map((org) => ({
          context: { id: org.id, type: "org" as const },
          label: org.name,
          value: `org:${org.id}`,
        }))
    : []),
];

const languageName = (locale: string, display: string): string => {
  try {
    return (
      new Intl.DisplayNames([display], { type: "language" }).of(locale) ??
      locale
    );
  } catch {
    return locale;
  }
};

const Profile = ({ me }: { readonly me: Me }) => {
  const initials = me.user.name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-10">
        {me.user.image ? <AvatarImage alt="" src={me.user.image} /> : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{me.user.name}</span>
        <span className="truncate text-muted-foreground text-sm">
          {me.user.email}
        </span>
      </div>
    </div>
  );
};

const Preferences = ({
  config,
  me,
  settings,
}: {
  readonly config: PublicConfig | undefined;
  readonly me: Me;
  readonly settings: UserSettings;
}) => {
  const { i18n, t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const settingsKey = query.me.settings.queryKey();

  // Optimistic through the mutation's own variables (TanStack v5): the
  // Select shows the pending value at once and falls back if it fails.
  const update = useMutation(
    query.me.updateSettings.mutationOptions({
      onSettled: (_data, _error, input) => {
        queryClient.invalidateQueries({ queryKey: settingsKey });
        if (input.locale !== undefined) {
          // The server renders in the saved locale; re-render to pick it up.
          router.refresh();
        }
      },
    })
  );
  const pending = update.isPending ? update.variables : undefined;
  const locale =
    pending?.locale === undefined ? settings.locale : pending.locale;
  const defaultContext = pending?.defaultContext ?? settings.defaultContext;

  const languages: readonly Option<string>[] = [
    { label: t`Match my browser`, value: BROWSER },
    ...supportedLocales.map((code) => ({
      label: languageName(code, i18n.locale),
      value: code,
    })),
  ];
  const contexts = contextOptions(
    me,
    config?.policies.chatContexts ?? ["personal"],
    { personal: t`Personal` }
  );

  const { mutate } = update;
  const setLocale = useCallback(
    (value: string) => mutate({ locale: value === BROWSER ? null : value }),
    [mutate]
  );
  const setContext = useCallback(
    (value: string) => {
      const picked = contexts.find((option) => option.value === value);
      if (picked) {
        mutate({ defaultContext: picked.context });
      }
    },
    [contexts, mutate]
  );

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="language">
          <Trans>Language</Trans>
        </FieldLabel>
        <OptionSelect
          className="w-64"
          id="language"
          onChange={setLocale}
          options={languages}
          value={locale ?? BROWSER}
        />
        <FieldDescription>
          <Trans>
            Used for the interface and passed to agents so they answer in your
            language.
          </Trans>
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="default-context">
          <Trans>Default chat context</Trans>
        </FieldLabel>
        <OptionSelect
          className="w-64"
          disabled={contexts.length < 2}
          id="default-context"
          onChange={setContext}
          options={contexts}
          value={contextKey(defaultContext)}
        />
        <FieldDescription>
          <Trans>
            New chats start here: it decides whose keys pay and where usage
            counts. You can change it in a chat until the first message.
          </Trans>
        </FieldDescription>
      </Field>
      {update.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>That change couldn't be saved. Try again.</Trans>
        </p>
      ) : null}
    </FieldGroup>
  );
};

export const ProfileSettings = () => {
  const { query } = useApi();
  const me = useQuery(query.me.get.queryOptions());
  const settings = useQuery(query.me.settings.queryOptions());
  // Public config only narrows the context list; without it, Personal only.
  const config = useQuery(query.meta.config.queryOptions());

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Profile</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Your name and email come from how you signed in.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState query={me} skeleton={1}>
            {(data) => <Profile me={data} />}
          </QueryState>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Preferences</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={settings} skeleton={2}>
            {(data) =>
              me.data ? (
                <Preferences
                  config={config.data}
                  me={me.data}
                  settings={data}
                />
              ) : null
            }
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
};

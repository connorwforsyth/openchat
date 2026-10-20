"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConversationId,
  LibraryItemId,
  OrgId,
} from "@workspace/contract/schemas/common";
import type {
  Space,
  SpaceContentItem,
  SpaceContentType,
} from "@workspace/contract/schemas/spaces";
import {
  BotIcon,
  LayersIcon,
  MessageSquareIcon,
  SettingsIcon,
  SparklesIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { useAppFrame } from "@/app/(app)/_shared/app-frame";
import { type Option, OptionSelect } from "@/app/(app)/_shared/option-select";
import { useActiveSpace } from "@/app/(app)/_shared/spaces/space-switcher";
import { routes } from "@/lib/routes";

// The active space's page (187): chats, agents and skills shared in it, and
// what flows down from the spaces above it, each marked with where it was
// shared. Owners and members share their own things here.

const hrefFor = (item: SpaceContentItem): string => {
  switch (item.resourceType) {
    case "conversation":
      return routes.chat(item.resourceId as ConversationId);
    case "agent":
      return routes.chatWithAgent(item.resourceId as LibraryItemId);
    case "skill":
      return routes.libraryItem(item.resourceId as LibraryItemId);
    default: {
      const unreachable: never = item.resourceType;
      return unreachable;
    }
  }
};

const Group = ({
  empty,
  icon,
  items,
  space,
  title,
}: {
  readonly empty: ReactNode;
  readonly icon: ReactNode;
  readonly items: readonly SpaceContentItem[];
  readonly space: Space;
  readonly title: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      {title}
    </h2>
    {items.length === 0 ? (
      <p className="text-muted-foreground text-sm">{empty}</p>
    ) : (
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const inherited =
            item.sharedIn.id !== space.id || item.sharedIn.type !== space.type;
          return (
            <li key={`${item.resourceType}:${item.resourceId}`}>
              <Link
                className="flex h-full flex-col gap-1.5 rounded-lg border border-border p-3 outline-none transition-colors duration-(--motion-fast) hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                data-testid="space-item"
                href={hrefFor(item)}
              >
                <span className="font-medium text-sm">{item.title}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                  {inherited ? (
                    <Badge variant="secondary">
                      <Trans>From {item.sharedInName}</Trans>
                    </Badge>
                  ) : null}
                  <Trans>Shared by {item.sharedBy.name}</Trans>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

const ShareSomething = ({ space }: { readonly space: Space }) => {
  const { t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const mine = useQuery(
    query.library.list.queryOptions({ input: { tab: "mine" } })
  );
  const share = useMutation(
    query.spaces.share.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: query.spaces.key() }),
    })
  );
  const [picked, setPicked] = useState("");
  const items = (mine.data?.items ?? []).filter(
    (item) => item.kind === "agent" || item.kind === "skill"
  );
  if (items.length === 0) {
    return null;
  }
  const options: readonly Option<string>[] = [
    { label: t`Share one of your agents or skills`, value: "" },
    ...items.map((item) => ({ label: item.name, value: item.id })),
  ];
  const submit = () => {
    const item = items.find((each) => each.id === picked);
    if (item) {
      share.mutate({
        id: space.id as OrgId,
        resourceId: item.id,
        resourceType: item.kind as SpaceContentType,
        type: space.type,
      });
      setPicked("");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <OptionSelect
        className="w-72"
        label={t`Share to ${space.name}`}
        onChange={setPicked}
        options={options}
        value={picked}
      />
      <Button disabled={!picked} onClick={submit} variant="outline">
        <Trans>Share</Trans>
      </Button>
    </div>
  );
};

export const SpaceHome = () => {
  const { t } = useLingui();
  const { query } = useApi();
  const { openSettings } = useAppFrame();
  const { active, status } = useActiveSpace();
  const openSpaceSettings = useCallback(
    () => openSettings("space-members"),
    [openSettings]
  );
  const content = useQuery({
    ...query.spaces.content.queryOptions({
      input: active
        ? { id: active.id as OrgId, type: active.type }
        : { id: "" as OrgId, type: "org" },
    }),
    enabled: active !== undefined,
  });
  if (!active) {
    return status === "pending" ? null : (
      <p className="p-8 text-muted-foreground text-sm">
        <Trans>No spaces yet.</Trans>
      </p>
    );
  }
  const items = content.data ?? [];
  const of = (type: SpaceContentType) =>
    items.filter((item) => item.resourceType === type);
  const name = active.isPersonal ? t`Personal` : active.name;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="flex items-center gap-2 font-medium text-2xl">
            <LayersIcon aria-hidden className="size-5 text-muted-foreground" />
            {name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {active.isPersonal ? (
              <Trans>
                Only you. Pick a space in the sidebar to see what's shared
                there.
              </Trans>
            ) : (
              <Trans>
                {active.memberCount} members. New chats you start here use{" "}
                {name}'s keys and allowance, and what's shared in the spaces
                above it shows here too.
              </Trans>
            )}
          </p>
        </div>
        {active.isPersonal ? null : (
          <Button onClick={openSpaceSettings} variant="outline">
            <SettingsIcon />
            <Trans>Space settings</Trans>
          </Button>
        )}
      </header>
      {active.isPersonal || active.access === "root_member" ? null : (
        <ShareSomething space={active} />
      )}
      <Group
        empty={<Trans>No chats shared here yet.</Trans>}
        icon={<MessageSquareIcon />}
        items={of("conversation")}
        space={active}
        title={<Trans>Chats</Trans>}
      />
      <Group
        empty={<Trans>No agents shared here yet.</Trans>}
        icon={<BotIcon />}
        items={of("agent")}
        space={active}
        title={<Trans>Agents</Trans>}
      />
      <Group
        empty={<Trans>No skills shared here yet.</Trans>}
        icon={<SparklesIcon />}
        items={of("skill")}
        space={active}
        title={<Trans>Skills</Trans>}
      />
    </div>
  );
};

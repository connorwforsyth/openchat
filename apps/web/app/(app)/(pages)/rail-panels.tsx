"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { kindIcon } from "@workspace/chat-ui/artifacts/kind-icon";
import {
  artifactKindLabels,
  artifactKinds,
} from "@workspace/chat-ui/model/artifact-kinds";
import { RailPanel } from "@workspace/chat-ui/sidebar/rail-panel";
import type { RailDestination } from "@workspace/chat-ui/sidebar/sidebar-rail";
import { libraryTabSchema } from "@workspace/contract/schemas/library";
import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
import {
  Building2Icon,
  ClockIcon,
  EllipsisIcon,
  InfoIcon,
  LayoutGridIcon,
  NetworkIcon,
  NewChatIcon,
  PlusIcon,
  SettingsIcon,
  ShareIcon,
  SparklesIcon,
  UsersIcon,
} from "@workspace/icons";
import {
  libraryKindIcon,
  useKindPlurals,
} from "@workspace/library-ui/components/kind";
import { BUILDABLE_KINDS } from "@workspace/library-ui/kinds";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { useTerms } from "@/app/(app)/_shared/terms";
import {
  installedServers,
  useCustomizeServers,
  useCustomizeSkills,
} from "@/app/(app)/(pages)/customize/customize-data";
import {
  customizeKindOf,
  customizeViewFromPath,
} from "@/app/(app)/(pages)/customize/customize-path";
import { ItemTile } from "@/app/(app)/(pages)/customize/item-tile";
import { type TryNow, useTryNow } from "@/app/(app)/(pages)/customize/try-now";
import { useNextRunText } from "@/app/(app)/(pages)/dots/schedule-text";
import { routeParams, routes } from "@/lib/routes";

// What the panel shows for each rail destination but Chats (181): the page's
// own navigation, as ChatGPT's panel follows its rail. The page reads the
// same query parameters these links set (`?kind=`, `?tab=`).

const RECENT_ARTIFACTS = 8;
const iconClass = "size-4 shrink-0";

/** Refetch while shown, so "Next …" stays current, as the page does. */
const SCHEDULES_REFRESH_MS = 30_000;

export function ScheduledPanel() {
  const { t } = useLingui();
  const { query } = useApi();
  const params = useSearchParams();
  const nextText = useNextRunText();
  const schedules = useQuery({
    ...query.schedules.list.queryOptions({ input: {} }),
    refetchInterval: SCHEDULES_REFRESH_MS,
  });
  const open = params.get(routeParams.edit);
  const links = (schedules.data ?? []).map((schedule) => {
    let meta: string | null = null;
    switch (schedule.status) {
      case "active":
        meta = nextText(schedule.nextRunNominalAt);
        break;
      case "paused":
        meta = t`Paused`;
        break;
      case "completed":
        meta = t`Done`;
        break;
      default:
        meta = schedule.status satisfies never;
    }
    return {
      active: open === schedule.id,
      href: routes.scheduleEdit(schedule.id),
      icon: <ClockIcon aria-hidden className={iconClass} />,
      id: schedule.id,
      label: schedule.title,
      meta,
    };
  });
  return (
    <RailPanel
      action={{
        active: open === "new",
        href: routes.scheduleEdit("new"),
        icon: <PlusIcon aria-hidden className={iconClass} />,
        id: "new-task",
        label: t`New task`,
      }}
      label={t`Scheduled`}
      sections={[
        {
          empty: schedules.isPending ? null : t`Nothing scheduled yet.`,
          heading: t`Tasks`,
          id: "tasks",
          links,
        },
      ]}
    />
  );
}

export function LibraryPanel() {
  const { t } = useLingui();
  const params = useSearchParams();
  const plurals = useKindPlurals();
  const kind = params.get(routeParams.kind);
  const tab = libraryTabSchema.catch("mine").parse(params.get(routeParams.tab));
  const inSpace = usePathname().startsWith(routes.space);
  const browsing = tab === "mine" && !inSpace;
  const newKind =
    BUILDABLE_KINDS.find((each) => each === kind) ?? BUILDABLE_KINDS[0];
  return (
    <RailPanel
      action={{
        href: routes.libraryNew(newKind),
        icon: <PlusIcon aria-hidden className={iconClass} />,
        id: "new",
        label: t`New`,
      }}
      label={t`Library`}
      sections={[
        {
          id: "kinds",
          links: [
            {
              active: browsing && kind === null,
              href: routes.library,
              icon: <LayoutGridIcon aria-hidden className={iconClass} />,
              id: "all",
              label: t`All`,
            },
            ...BUILDABLE_KINDS.map((each) => {
              const Glyph = libraryKindIcon(each);
              return {
                active: browsing && kind === each,
                href: routes.libraryOfKind(each),
                icon: <Glyph aria-hidden className={iconClass} />,
                id: each,
                label: plurals[each],
              };
            }),
          ],
        },
        {
          heading: t`From others`,
          id: "sources",
          links: [
            {
              active: !inSpace && tab === "shared",
              href: routes.libraryTab("shared"),
              icon: <ShareIcon aria-hidden className={iconClass} />,
              id: "shared",
              label: t`Shared with me`,
            },
            {
              active: !inSpace && tab === "libraries",
              href: routes.libraryTab("libraries"),
              icon: <UsersIcon aria-hidden className={iconClass} />,
              id: "libraries",
              label: t`Team & org`,
            },
            {
              active: inSpace,
              href: routes.space,
              icon: <Building2Icon aria-hidden className={iconClass} />,
              id: "space",
              label: t`Space`,
            },
          ],
        },
      ]}
    />
  );
}

export function ArtifactsPanel() {
  const { i18n, t } = useLingui();
  const params = useSearchParams();
  const { query } = useApi();
  const kind = artifactKindSchema
    .nullable()
    .catch(null)
    .parse(params.get(routeParams.kind));
  const recent = useQuery(
    query.artifacts.listAll.queryOptions({
      input: { limit: RECENT_ARTIFACTS, scope: "all" },
    })
  );
  const recentLinks = useMemo(
    () =>
      (recent.data?.items ?? []).map((item) => {
        const Glyph = kindIcon(item.kind);
        return {
          href: routes.artifact(item.id),
          icon: <Glyph aria-hidden className={iconClass} />,
          id: item.id,
          label: item.title,
        };
      }),
    [recent.data]
  );
  return (
    <RailPanel
      label={t`Artifacts`}
      sections={[
        {
          id: "kinds",
          links: [
            {
              active: kind === null,
              href: routes.artifacts,
              icon: <LayoutGridIcon aria-hidden className={iconClass} />,
              id: "all",
              label: t`All kinds`,
            },
            ...artifactKinds.map((each) => {
              const Glyph = kindIcon(each);
              return {
                active: kind === each,
                href: routes.artifactsOfKind(each),
                icon: <Glyph aria-hidden className={iconClass} />,
                id: each,
                label: i18n._(artifactKindLabels[each]),
              };
            }),
          ],
        },
        {
          empty: recent.isPending ? null : t`Nothing yet.`,
          heading: t`Recent`,
          id: "recent",
          links: recentLinks,
        },
      ]}
    />
  );
}

/** An installed item's ⋯ menu (193): its page, its controls, a new chat. */
const InstalledMenu = ({
  detailHref,
  manageHref,
  name,
  tryNow,
}: {
  readonly detailHref: string;
  readonly manageHref: string;
  readonly name: string;
  readonly tryNow: TryNow;
}) => {
  const { t } = useLingui();
  const start = useTryNow();
  const onTryNow = useCallback(() => start(tryNow), [start, tryNow]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Options for ${name}`}
            size="icon-xs"
            title={t`Options for ${name}`}
            variant="ghost"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem render={<a href={detailHref} />}>
          <InfoIcon aria-hidden />
          <Trans>Details</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={manageHref} />}>
          <SettingsIcon aria-hidden />
          <Trans>Manage</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTryNow}>
          <NewChatIcon aria-hidden />
          <Trans>Try now</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Customize (193), after ChatGPT's: the two catalogs, then what's
 * installed: the servers you have on, and the skills you can pick.
 */
export function CustomizePanel() {
  const { t } = useLingui();
  const terms = useTerms();
  const pathname = usePathname();
  const servers = useCustomizeServers();
  const { pending, skills } = useCustomizeSkills();
  const view = customizeViewFromPath(
    pathname.split("/").filter(Boolean).slice(1),
    terms
  );
  const openKind = customizeKindOf(view);
  const openId =
    view.view === "item" || view.view === "manage" ? view.id : null;
  const serverLinks = installedServers(servers.data?.connectors ?? []).map(
    (server) => {
      const { title } = server;
      const href = routes.customizeItem(terms, "mcp", server.id);
      return {
        active: openId === server.id,
        href,
        icon: <ItemTile name={title} />,
        id: server.id,
        label: title,
        menu: (
          <InstalledMenu
            detailHref={href}
            manageHref={routes.customizeManage(terms, server.id)}
            name={title}
            tryNow={{
              href: routes.newChatWithMcp(server.id),
              text: t`What can you help me with using ${title}?`,
            }}
          />
        ),
      };
    }
  );
  const skillLinks = skills.map(({ item }) => {
    const { name } = item;
    const href = routes.customizeItem(terms, "skills", item.id);
    return {
      active: openId === item.id,
      href,
      icon: <ItemTile icon={item.icon} name={name} />,
      id: item.id,
      label: name,
      menu: (
        <InstalledMenu
          detailHref={href}
          manageHref={routes.libraryItem(item.id)}
          name={name}
          tryNow={{
            href: routes.home,
            skill: { id: item.id, name },
            text: t`Show me what the ${name} skill can do.`,
          }}
        />
      ),
    };
  });
  const loading = servers.isPending || pending;
  return (
    <RailPanel
      label={t`Customize`}
      sections={[
        {
          id: "kinds",
          links: [
            {
              active: openKind === "mcp" && openId === null,
              href: routes.customizeKind(terms, "mcp"),
              icon: <NetworkIcon aria-hidden className={iconClass} />,
              id: "mcp",
              label: terms.mcp.label,
            },
            {
              active: openKind === "skills" && openId === null,
              href: routes.customizeKind(terms, "skills"),
              icon: <SparklesIcon aria-hidden className={iconClass} />,
              id: "skills",
              label: t`Skills`,
            },
          ],
        },
        {
          empty: loading ? null : t`Nothing installed yet.`,
          heading: t`Installed`,
          id: "installed",
          links: [...serverLinks, ...skillLinks],
        },
      ]}
    />
  );
}

/** The panel for a rail destination; Chats (and the Dot) keep the chat list. */
export function RailPanelFor({
  destination,
}: {
  readonly destination: RailDestination;
}) {
  switch (destination) {
    case "artifacts":
      return <ArtifactsPanel />;
    case "library":
      return <LibraryPanel />;
    case "scheduled":
      return <ScheduledPanel />;
    case "customize":
      return <CustomizePanel />;
    case "chats":
    case "dot":
      return null;
    default:
      return destination satisfies never;
  }
}

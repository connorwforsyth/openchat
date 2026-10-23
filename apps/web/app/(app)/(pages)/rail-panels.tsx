"use client";

import { useLingui } from "@lingui/react/macro";
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
  LayoutGridIcon,
  PlusIcon,
  ShareIcon,
  UsersIcon,
} from "@workspace/icons";
import {
  libraryKindIcon,
  useKindPlurals,
} from "@workspace/library-ui/components/kind";
import { BUILDABLE_KINDS } from "@workspace/library-ui/kinds";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
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
      icon: (
        <span aria-hidden className={`${iconClass} text-sm leading-4`}>
          {schedule.emoji}
        </span>
      ),
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
  return (
    <RailPanel
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
              label: t`Spaces`,
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
    case "chats":
    case "dot":
      return null;
    default:
      return destination satisfies never;
  }
}

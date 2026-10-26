"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import type {
  ArtifactListItem,
  ArtifactScope,
} from "@workspace/contract/schemas/files";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import type { Me } from "@workspace/contract/schemas/meta";
import { formatDate, formatRelativeTime } from "@workspace/i18n/format";
import {
  ChevronDownIcon,
  LayoutGridIcon,
  ListIcon,
  LockIcon,
  SearchIcon,
  UsersIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

import {
  type ArtifactGroupKey,
  groupArtifacts,
} from "../model/artifact-groups";
import {
  artifactKindDefinition,
  artifactKindLabels,
  artifactKinds,
  displayedKinds,
  offersKind,
  starterKinds,
  starterLabels,
} from "../model/artifact-kinds";
import { type ArtifactLinks, ArtifactMenu } from "./artifact-actions";
import { ArtifactThumbnail } from "./artifact-thumbnail";
import { KindIcon, kindIcon } from "./kind-icon";
import { useOfferedKinds } from "./use-offered-kinds";

// The Artifacts page (124, the framework proposal's "Artifacts page"):
// everything you made or that was shared with you, across chats. Tabs All /
// Yours / Shared with you, search, a kind filter and list or grid at the
// right; "Make something new" cards; then the list grouped by date, most
// recently viewed first. Each row has the kind's icon, the title, who can
// see it, when you last viewed it, and its ⋯ menu.

export type ArtifactLinkComponent = ComponentType<{
  readonly children: ReactNode;
  readonly className?: string;
  readonly href: string;
}>;

const PlainLink: ArtifactLinkComponent = ({ children, className, href }) => (
  <a className={className} href={href}>
    {children}
  </a>
);

export interface ArtifactPageLinks extends ArtifactLinks {
  readonly artifact: (id: ArtifactId) => string;
}

export interface ArtifactsPageProps {
  readonly api: QueryUtils;
  /** The kind filter to start on, say from the panel's kinds (181). */
  readonly initialKind?: ArtifactKind;
  /**
   * The kinds this instance offers, for "Make something new" (161); every
   * built-in kind when left out.
   */
  readonly kinds?: readonly ArtifactKind[];
  /** Client-side navigation for the rows' links; a plain `<a>` by default. */
  readonly link?: ArtifactLinkComponent;
  readonly links: ArtifactPageLinks;
  readonly me: Me;
  /** The clock for date groups and "Viewed …"; defaults to now. */
  readonly now?: Date;
  /** "Make something new": starts a new chat that sends `prompt`. */
  readonly onStart: (prompt: string) => void;
  /**
   * Where the grid's picture of an artifact comes from, for kinds whose
   * `thumbnail` is `runtime`; `null` (or left out) shows the kind's icon.
   */
  readonly thumbnailUrl?: (item: ArtifactListItem) => string | null;
}

type View = "list" | "grid";
const PAGE_SIZE = 50;

/** When the row was last seen by the viewer, or else changed. */
const seenAt = (item: ArtifactListItem): number =>
  new Date(item.viewedAt ?? item.updatedAt).getTime();

export function ArtifactsPage({
  api,
  initialKind,
  kinds,
  link = PlainLink,
  links,
  me,
  now,
  onStart,
  thumbnailUrl,
}: ArtifactsPageProps) {
  const { t } = useLingui();
  const fromConfig = useOfferedKinds(api);
  const offered = kinds ?? fromConfig;
  const [scope, setScope] = useState<ArtifactScope>("all");
  const [kind, setKind] = useState<ArtifactKind | "all">(initialKind ?? "all");
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());

  const changeScope = useCallback((value: unknown) => {
    if (value === "all" || value === "mine" || value === "shared") {
      setScope(value);
    }
  }, []);
  const changeView = useCallback((values: string[]) => {
    const [next] = values;
    if (next === "list" || next === "grid") {
      setView(next);
    }
  }, []);
  const changeSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setSearch(event.currentTarget.value),
    []
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-medium text-xl">
          <Trans>Artifacts</Trans>
        </h1>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Documents, pages and diagrams from your chats, and ones shared with
            you.
          </Trans>
        </p>
      </header>

      <StarterCards kinds={offered} onStart={onStart} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs onValueChange={changeScope} value={scope}>
            <TabsList>
              <TabsTrigger value="all">
                <Trans>All</Trans>
              </TabsTrigger>
              <TabsTrigger value="mine">
                <Trans>Yours</Trans>
              </TabsTrigger>
              <TabsTrigger value="shared">
                <Trans>Shared with you</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="w-full sm:w-56">
              <InputGroupInput
                aria-label={t`Search artifacts`}
                onChange={changeSearch}
                placeholder={t`Search`}
                type="search"
                value={search}
              />
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
            </InputGroup>
            <KindFilter kinds={offered} onChange={setKind} value={kind} />
            <ToggleGroup
              aria-label={t`Layout`}
              className="max-md:hidden"
              onValueChange={changeView}
              size="sm"
              value={[view]}
              variant="outline"
            >
              <ToggleGroupItem aria-label={t`List`} value="list">
                <ListIcon aria-hidden />
              </ToggleGroupItem>
              <ToggleGroupItem aria-label={t`Grid`} value="grid">
                <LayoutGridIcon aria-hidden />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <ArtifactList
          api={api}
          filtered={kind !== "all" || query !== ""}
          kind={kind === "all" ? undefined : kind}
          link={link}
          links={links}
          me={me}
          now={now}
          query={query}
          scope={scope}
          thumbnailUrl={thumbnailUrl}
          view={view}
        />
      </div>
    </div>
  );
}

function StarterCards({
  kinds,
  onStart,
}: {
  readonly kinds?: readonly ArtifactKind[];
  readonly onStart: (prompt: string) => void;
}) {
  const starters = useMemo(() => starterKinds(kinds), [kinds]);
  if (starters.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="make-something-new"
      className="flex flex-col gap-3"
    >
      <h2 className="font-medium text-sm" id="make-something-new">
        <Trans>Make something new</Trans>
      </h2>
      {/* Mobile: the cards scroll sideways rather than stack. */}
      <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-5">
        {starters.map((each) => (
          <StarterCard key={each} kind={each} onStart={onStart} />
        ))}
      </ul>
    </section>
  );
}

function StarterCard({
  kind,
  onStart,
}: {
  readonly kind: ArtifactKind;
  readonly onStart: (prompt: string) => void;
}) {
  const { i18n, t } = useLingui();
  const label = i18n._(starterLabels[kind] ?? artifactKindLabels[kind]);
  const Glyph = kindIcon(kind);
  const badge = artifactKindDefinition(kind).starter?.badge;
  const start = useCallback(
    () =>
      onStart(
        t`Let's make a new artifact (${label}). Ask me what it's for first, then make it.`
      ),
    [label, onStart, t]
  );
  return (
    <li className="shrink-0">
      <button
        className="flex h-24 w-36 flex-col justify-between rounded-xl border border-border bg-card p-3 text-start outline-none transition-colors duration-(--motion-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:w-full"
        onClick={start}
        type="button"
      >
        <span className="flex items-start justify-between gap-2">
          <Glyph aria-hidden className="size-5 text-muted-foreground" />
          {badge ? <StarterBadge badge={badge} /> : null}
        </span>
        <span className="font-medium text-sm">{label}</span>
      </button>
    </li>
  );
}

function StarterBadge({ badge }: { readonly badge: "beta" | "new" }) {
  switch (badge) {
    case "new":
      return (
        <Badge variant="secondary">
          <Trans context="artifact kind badge">New</Trans>
        </Badge>
      );
    case "beta":
      return (
        <Badge variant="outline">
          <Trans context="artifact kind badge">Beta</Trans>
        </Badge>
      );
    default:
      return badge satisfies never;
  }
}

function KindFilter({
  kinds,
  onChange,
  value,
}: {
  /** The kinds offered, and the one picked even if it's turned off. */
  readonly kinds: readonly ArtifactKind[];
  readonly onChange: (kind: ArtifactKind | "all") => void;
  readonly value: ArtifactKind | "all";
}) {
  const { i18n, t } = useLingui();
  const change = useCallback(
    (next: unknown) => {
      const found = artifactKinds.find((each) => each === next);
      onChange(found ?? "all");
    },
    [onChange]
  );
  const current =
    value === "all" ? t`All kinds` : i18n._(artifactKindLabels[value]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Kind: ${current}`}
            size="sm"
            variant="outline"
          />
        }
      >
        {current}
        <ChevronDownIcon aria-hidden data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup onValueChange={change} value={value}>
          <DropdownMenuRadioItem closeOnClick value="all">
            <Trans>All kinds</Trans>
          </DropdownMenuRadioItem>
          {displayedKinds
            .filter((each) => offersKind(kinds, each) || each === value)
            .map((each) => (
              <DropdownMenuRadioItem closeOnClick key={each} value={each}>
                {i18n._(artifactKindLabels[each])}
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArtifactList({
  api,
  filtered,
  kind,
  link,
  links,
  me,
  now,
  query,
  scope,
  thumbnailUrl,
  view,
}: {
  readonly api: QueryUtils;
  readonly filtered: boolean;
  readonly kind?: ArtifactKind;
  readonly link: ArtifactLinkComponent;
  readonly links: ArtifactPageLinks;
  readonly me: Me;
  readonly now?: Date;
  readonly query: string;
  readonly scope: ArtifactScope;
  readonly thumbnailUrl?: (item: ArtifactListItem) => string | null;
  readonly view: View;
}) {
  const list = useInfiniteQuery(
    api.artifacts.listAll.infiniteOptions({
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      initialPageParam: undefined as string | undefined,
      input: (cursor) => ({
        cursor,
        kind,
        limit: PAGE_SIZE,
        query: query === "" ? undefined : query,
        scope,
      }),
      // A new filter keeps the old rows up until its own arrive.
      placeholderData: keepPreviousData,
    })
  );
  const { fetchNextPage } = list;
  const more = useCallback(() => fetchNextPage(), [fetchNextPage]);
  const items = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data]
  );
  const clock = now ?? new Date();
  const groups = useMemo(
    () => groupArtifacts(items, seenAt, now ?? new Date()),
    [items, now]
  );

  if (list.isPending) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans>Loading…</Trans>
      </p>
    );
  }
  if (list.isError) {
    return (
      <p className="text-destructive text-sm" role="alert">
        <Trans>Artifacts couldn't be loaded.</Trans>
      </p>
    );
  }
  if (items.length === 0) {
    return <EmptyList filtered={filtered} scope={scope} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section aria-labelledby={`artifacts-${group.id}`} key={group.id}>
          <h2
            className="mb-2 font-medium text-muted-foreground text-xs"
            id={`artifacts-${group.id}`}
          >
            <GroupHeading group={group.key} />
          </h2>
          <ul
            className={cn(
              view === "grid"
                ? "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
                : "flex flex-col divide-y divide-border"
            )}
          >
            {group.items.map((item) =>
              view === "grid" ? (
                <ArtifactCard
                  api={api}
                  item={item}
                  key={item.id}
                  link={link}
                  links={links}
                  me={me}
                  now={clock}
                  thumbnailUrl={thumbnailUrl}
                />
              ) : (
                <ArtifactRow
                  api={api}
                  item={item}
                  key={item.id}
                  link={link}
                  links={links}
                  me={me}
                  now={clock}
                />
              )
            )}
          </ul>
        </section>
      ))}
      {list.hasNextPage ? (
        <Button
          className="self-center"
          disabled={list.isFetchingNextPage}
          onClick={more}
          size="sm"
          variant="outline"
        >
          <Trans>Show more</Trans>
        </Button>
      ) : null}
    </div>
  );
}

function EmptyList({
  filtered,
  scope,
}: {
  readonly filtered: boolean;
  readonly scope: ArtifactScope;
}) {
  let message: ReactNode;
  if (filtered) {
    message = <Trans>Nothing matches. Try another search or kind.</Trans>;
  } else if (scope === "shared") {
    message = <Trans>Nothing has been shared with you yet.</Trans>;
  } else {
    message = (
      <Trans>
        No artifacts yet. Ask for a document, a page or a diagram in a chat and
        it shows up here.
      </Trans>
    );
  }
  return (
    <p className="py-8 text-center text-muted-foreground text-sm">{message}</p>
  );
}

function GroupHeading({ group }: { readonly group: ArtifactGroupKey }) {
  const { i18n } = useLingui();
  switch (group.type) {
    case "today":
      return <Trans>Today</Trans>;
    case "yesterday":
      return <Trans>Yesterday</Trans>;
    case "previous7Days":
      return <Trans>Previous 7 days</Trans>;
    case "month":
      return (
        <>
          {formatDate(new Date(group.year, group.month, 1), i18n.locale, {
            month: "long",
            year: "numeric",
          })}
        </>
      );
    default:
      return group satisfies never;
  }
}

/** Who can see it: only its owner, or people it's shared with. */
function Visibility({ item }: { readonly item: ArtifactListItem }) {
  const { t } = useLingui();
  const { ownerName: owner } = item;
  if (item.access !== "owner") {
    return (
      <span className="inline-flex items-center gap-1">
        <UsersIcon aria-hidden className="size-3.5" />
        <Trans>Shared by {owner}</Trans>
      </span>
    );
  }
  return item.visibility === "shared" ? (
    <span className="inline-flex items-center gap-1">
      <UsersIcon aria-label={t`Shared`} className="size-3.5" role="img" />
      <Trans>Shared</Trans>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <LockIcon aria-label={t`Only you`} className="size-3.5" role="img" />
      <Trans>Only you</Trans>
    </span>
  );
}

function Seen({
  item,
  now,
}: {
  readonly item: ArtifactListItem;
  readonly now: Date;
}) {
  const { i18n } = useLingui();
  const when = formatRelativeTime(
    item.viewedAt ?? item.updatedAt,
    i18n.locale,
    now
  );
  return item.viewedAt ? (
    <Trans>Viewed {when}</Trans>
  ) : (
    <Trans>Updated {when}</Trans>
  );
}

interface ItemProps {
  readonly api: QueryUtils;
  readonly item: ArtifactListItem;
  readonly link: ArtifactLinkComponent;
  readonly links: ArtifactPageLinks;
  readonly me: Me;
  readonly now: Date;
}

function ArtifactRow({ api, item, link: Link, links, me, now }: ItemProps) {
  return (
    <li
      className="flex min-h-14 items-center gap-3 py-2"
      data-artifact-id={item.id}
    >
      <KindIcon
        className="size-5 shrink-0 text-muted-foreground"
        kind={item.kind}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          className="truncate font-medium text-sm outline-none hover:underline focus-visible:underline"
          href={links.artifact(item.id)}
        >
          {item.title}
        </Link>
        <span className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
          <Visibility item={item} />
          <Seen item={item} now={now} />
        </span>
      </div>
      <ArtifactMenu api={api} artifact={item} links={links} me={me} />
    </li>
  );
}

function ArtifactCard({
  api,
  item,
  link: Link,
  links,
  me,
  now,
  thumbnailUrl,
}: ItemProps & {
  readonly thumbnailUrl?: (item: ArtifactListItem) => string | null;
}) {
  const src =
    artifactKindDefinition(item.kind).thumbnail === "runtime"
      ? (thumbnailUrl?.(item) ?? null)
      : null;
  return (
    <li
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
      data-artifact-id={item.id}
    >
      <ArtifactThumbnail kind={item.kind} src={src} />
      <div className="flex items-start gap-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            className="truncate font-medium text-sm outline-none hover:underline focus-visible:underline"
            href={links.artifact(item.id)}
          >
            {item.title}
          </Link>
          <span className="text-muted-foreground text-xs">
            <Seen item={item} now={now} />
          </span>
          <span className="text-muted-foreground text-xs">
            <Visibility item={item} />
          </span>
        </div>
        <ArtifactMenu api={api} artifact={item} links={links} me={me} />
      </div>
      {item.access === "editor" ? (
        <Badge className="self-start" variant="secondary">
          <Trans>Can edit</Trans>
        </Badge>
      ) : null}
    </li>
  );
}

"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type {
  LibraryItem,
  LibraryKind,
} from "@workspace/contract/schemas/library";
import {
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "@workspace/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import {
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useId,
  useRef,
  useState,
} from "react";

import type { LibraryTab } from "../cache";
import {
  useDeleteItem,
  useDuplicateItem,
  useExportItem,
  useImportItem,
  useLibraryList,
  useMe,
} from "../hooks";
import { BUILDABLE_KINDS } from "../kinds";
import { downloadJson, exportFileName, importDocumentFrom } from "../transfer";
import {
  AccessBadge,
  usePrincipalName,
  VersionBadge,
  VisibilityBadge,
} from "./badges";
import { ConfirmDelete } from "./confirm-delete";
import { KindTile, useKindLabels, useKindPlurals } from "./kind";

// The library (D13): three tabs (My library, Shared with me, Team & org),
// search and a kind filter over one list of cards. Opening an item goes to
// its builder; the page decides the URLs (`itemHref`, `newHref`) and the
// link component, so this works under Next or anywhere else.

export type LinkComponent = ComponentType<{
  readonly children: ReactNode;
  readonly className?: string;
  readonly href: string;
}>;

const PlainLink: LinkComponent = ({ children, className, href }) => (
  <a className={className} href={href}>
    {children}
  </a>
);

export interface LibraryIndexProps {
  readonly initialTab?: LibraryTab;
  readonly itemHref: (item: LibraryItem) => string;
  readonly link?: LinkComponent;
  /** Where "New" goes for each kind. */
  readonly newHref: (kind: LibraryKind) => string;
  /** After an import, open the new item. */
  readonly onImported?: (item: LibraryItem) => void;
  readonly onTabChange?: (tab: LibraryTab) => void;
}

type KindFilter = LibraryKind | "all";

export function LibraryIndex({
  initialTab = "mine",
  itemHref,
  link: Link = PlainLink,
  newHref,
  onImported,
  onTabChange,
}: LibraryIndexProps) {
  const { t } = useLingui();
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  // Typing stays responsive; the list follows a beat behind.
  const query = useDeferredValue(search.trim());
  const labels = useKindLabels();
  const plurals = useKindPlurals();

  const changeTab = useCallback(
    (next: unknown) => {
      const tabValue = next as LibraryTab;
      setTab(tabValue);
      onTabChange?.(tabValue);
    },
    [onTabChange]
  );
  const changeSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setSearch(event.currentTarget.value),
    []
  );
  // A toggle group can be emptied; empty means every kind.
  const changeKind = useCallback(
    (values: string[]) =>
      setKind((values[0] as KindFilter | undefined) ?? "all"),
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-medium text-xl">
            <Trans>Library</Trans>
          </h1>
          <p className="text-muted-foreground text-sm">
            <Trans>
              Agents, prompts, skills and MCP servers: yours, shared with you,
              and published to your teams.
            </Trans>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton onImported={onImported} />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" />}>
              <PlusIcon data-icon="inline-start" />
              <Trans>New</Trans>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                {BUILDABLE_KINDS.map((each) => (
                  <DropdownMenuItem
                    key={each}
                    render={<Link href={newHref(each)}>{labels[each]}</Link>}
                  />
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Tabs onValueChange={changeTab} value={tab}>
        <TabsList>
          <TabsTrigger value="mine">
            <Trans>My library</Trans>
          </TabsTrigger>
          <TabsTrigger value="shared">
            <Trans>Shared with me</Trans>
          </TabsTrigger>
          <TabsTrigger value="libraries">
            <Trans>Team & org</Trans>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-xs">
          <InputGroupInput
            aria-label={t`Search the library`}
            onChange={changeSearch}
            placeholder={t`Search`}
            type="search"
            value={search}
          />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          aria-label={t`Kind`}
          onValueChange={changeKind}
          size="sm"
          value={[kind]}
          variant="outline"
        >
          <ToggleGroupItem value="all">
            <Trans>All</Trans>
          </ToggleGroupItem>
          {BUILDABLE_KINDS.map((each) => (
            <ToggleGroupItem key={each} value={each}>
              {plurals[each]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <ItemList
        itemHref={itemHref}
        kind={kind === "all" ? undefined : kind}
        link={Link}
        query={query}
        tab={tab}
      />
    </div>
  );
}

function ImportButton({
  onImported,
}: {
  readonly onImported?: (item: LibraryItem) => void;
}) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  const importItem = useImportItem();
  const [problem, setProblem] = useState<string | null>(null);

  const { mutate: importDocument } = importItem;
  const browse = useCallback(() => input.current?.click(), []);
  const pick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) {
        return;
      }
      const document = importDocumentFrom(await file.text());
      if (!document.ok) {
        setProblem(
          document.error === "not_json"
            ? t`That file isn't JSON.`
            : t`That isn't a library export or a LibreChat agent.`
        );
        return;
      }
      setProblem(null);
      importDocument(document.value, {
        onError: () => setProblem(t`The import was refused.`),
        onSuccess: (item) => onImported?.(item),
      });
    },
    [importDocument, onImported, t]
  );

  return (
    <div className="flex items-center gap-2">
      {problem ? (
        <span className="text-destructive text-sm" role="alert">
          {problem}
        </span>
      ) : null}
      <input
        accept="application/json,.json"
        aria-label={t`Import file`}
        className="sr-only"
        onChange={pick}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      <Button
        disabled={importItem.isPending}
        onClick={browse}
        size="sm"
        variant="outline"
      >
        <UploadIcon data-icon="inline-start" />
        <Trans>Import</Trans>
      </Button>
    </div>
  );
}

function ItemList({
  itemHref,
  kind,
  link,
  query,
  tab,
}: {
  readonly itemHref: (item: LibraryItem) => string;
  readonly kind?: LibraryKind;
  readonly link: LinkComponent;
  readonly query: string;
  readonly tab: LibraryTab;
}) {
  const list = useLibraryList({ kind, query, tab });
  const me = useMe();
  const { fetchNextPage } = list;
  const more = useCallback(() => fetchNextPage(), [fetchNextPage]);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  if (list.isPending) {
    return (
      <ul aria-busy className="grid gap-2 sm:grid-cols-2">
        {["a", "b", "c", "d"].map((key) => (
          <li key={key}>
            <Skeleton className="h-20 rounded-lg" />
          </li>
        ))}
      </ul>
    );
  }
  if (list.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          <Trans>The library didn't load</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>Check your connection and try again.</Trans>
        </AlertDescription>
      </Alert>
    );
  }
  if (items.length === 0) {
    return <EmptyTab filtered={query !== "" || kind !== undefined} tab={tab} />;
  }
  const count = items.length;
  return (
    <section className="flex flex-col gap-3">
      <p aria-live="polite" className="sr-only">
        <Plural one="# item" other="# items" value={count} />
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <ItemCard
              href={itemHref(item)}
              item={item}
              link={link}
              me={me.data}
              showOwner={tab !== "mine"}
            />
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          className="self-center"
          disabled={list.isFetchingNextPage}
          onClick={more}
          variant="ghost"
        >
          <Trans>Show more</Trans>
        </Button>
      ) : null}
    </section>
  );
}

function EmptyTab({
  filtered,
  tab,
}: {
  readonly filtered: boolean;
  readonly tab: LibraryTab;
}) {
  let title: ReactNode;
  let description: ReactNode;
  if (filtered) {
    title = <Trans>Nothing matches</Trans>;
    description = <Trans>Try another search or kind.</Trans>;
  } else if (tab === "mine") {
    title = <Trans>Nothing here yet</Trans>;
    description = (
      <Trans>Build an agent, prompt, skill or MCP server, or import one.</Trans>
    );
  } else if (tab === "shared") {
    title = <Trans>Nothing shared with you</Trans>;
    description = (
      <Trans>
        When someone shares an item with you or your team, it shows up here.
      </Trans>
    );
  } else {
    title = <Trans>No team or org items</Trans>;
    description = (
      <Trans>Items published to your teams and orgs show up here.</Trans>
    );
  }
  return (
    <Empty className="border border-border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const canView = (item: LibraryItem) => item.myAccess !== "use";
const canManage = (item: LibraryItem) =>
  item.myAccess === "owner" || item.myAccess === "maintainer";

export function ItemCard({
  href,
  item,
  link: Link,
  me,
  showOwner,
}: {
  readonly href: string;
  readonly item: LibraryItem;
  readonly link: LinkComponent;
  readonly me: Parameters<typeof usePrincipalName>[0];
  readonly showOwner: boolean;
}) {
  const { t } = useLingui();
  const ownerName = usePrincipalName(me);
  const duplicate = useDuplicateItem();
  const exportItem = useExportItem();
  const remove = useDeleteItem();
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const { id, name } = item;
  const { mutate: duplicateItem } = duplicate;
  const { mutate: exportJson } = exportItem;
  const { mutate: deleteItem } = remove;
  const copyToMine = useCallback(
    () => duplicateItem({ id }),
    [duplicateItem, id]
  );
  const download = useCallback(
    () =>
      exportJson(id, {
        onSuccess: (data) => downloadJson(exportFileName(name), data),
      }),
    [exportJson, id, name]
  );
  const askToDelete = useCallback(() => setConfirming(true), []);
  const confirmDelete = useCallback(() => deleteItem(id), [deleteItem, id]);
  const owner = ownerName(item.owner);

  return (
    <article
      aria-labelledby={titleId}
      className="group/card relative flex h-full items-start gap-3 rounded-lg border border-border bg-card p-3 transition-[background-color,transform] duration-100 focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted active:scale-[0.98]"
    >
      <KindTile kind={item.kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 pe-8">
        <Link
          className="truncate font-medium text-sm outline-none after:absolute after:inset-0 after:content-['']"
          href={href}
        >
          <span id={titleId}>{name}</span>
        </Link>
        {item.description ? (
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {item.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <VersionBadge item={item} />
          <VisibilityBadge visibility={item.visibility} />
          <AccessBadge access={item.myAccess} />
          {showOwner ? (
            <span className="text-muted-foreground text-xs">{owner}</span>
          ) : null}
        </div>
      </div>
      {canView(item) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t`Actions for ${name}`}
                className="absolute end-2 top-2 z-10"
                size="icon-xs"
                variant="ghost"
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={copyToMine}>
                <CopyIcon />
                <Trans>Duplicate to my library</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={download}>
                <DownloadIcon />
                <Trans>Export</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {canManage(item) ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={askToDelete} variant="destructive">
                    <Trash2Icon />
                    <Trans>Delete</Trans>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDelete
        name={name}
        onConfirm={confirmDelete}
        onOpenChange={setConfirming}
        open={confirming}
      />
    </article>
  );
}

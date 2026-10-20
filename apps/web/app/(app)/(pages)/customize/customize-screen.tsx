"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { Connector } from "@workspace/contract/schemas/library";
import {
  ChevronRightIcon,
  NewChatIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button, buttonVariants } from "@workspace/ui/components/button";
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
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import {
  Availability,
  LockNote,
  ServerDetail,
  useMcpToggle,
} from "@/app/(app)/_shared/settings/mcp/mcp-settings";
import { useTerms } from "@/app/(app)/_shared/terms";
import { routes } from "@/lib/routes";

import {
  type CustomizeSkill,
  useCustomizeServers,
  useCustomizeSkills,
} from "./customize-data";
import { type CustomizeView, customizeViewFromPath } from "./customize-path";
import { ItemTile } from "./item-tile";
import { useTryNow } from "./try-now";

// Customize (193), after ChatGPT's: a catalog per kind (MCP servers under
// whatever `terms:` calls them, and skills), and a page per item like an
// app store's, with Manage (the controls) and Try now (a new chat with it
// on and a starter prompt waiting). The panel beside the rail lists what's
// installed; Settings keeps only your defaults and links here.

const pageClass = "mx-auto flex w-full max-w-3xl flex-col gap-6";

const Crumbs = ({
  current,
  parent,
}: {
  readonly current: string;
  readonly parent: { readonly href: string; readonly label: string };
}) => {
  const { t } = useLingui();
  return (
    <nav aria-label={t`Breadcrumb`}>
      <ol className="flex items-center gap-1.5 text-muted-foreground text-sm">
        <li>
          <a className="hover:text-foreground" href={parent.href}>
            {parent.label}
          </a>
        </li>
        <li aria-hidden>
          <ChevronRightIcon className="size-3.5 rtl:-scale-x-100" />
        </li>
        <li aria-current="page" className="truncate text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
};

const SearchBox = ({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) => {
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange]
  );
  return (
    <InputGroup className="w-full sm:w-64">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        onChange={change}
        placeholder={label}
        type="search"
        value={value}
      />
    </InputGroup>
  );
};

const matches = (needle: string, ...fields: (string | null)[]): boolean => {
  const query = needle.trim().toLocaleLowerCase();
  return (
    query === "" ||
    fields.some((field) => field?.toLocaleLowerCase().includes(query))
  );
};

const CatalogHeader = ({
  action,
  children,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly children?: ReactNode;
  readonly description: ReactNode;
  readonly title: string;
}) => (
  <header className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-semibold text-2xl">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action}
    </div>
    {children}
  </header>
);

const CatalogRow = ({
  badge,
  description,
  href,
  icon,
  name,
}: {
  readonly badge?: ReactNode;
  readonly description: string | null;
  readonly href: string;
  readonly icon?: string | null;
  readonly name: string;
}) => (
  <li>
    <a
      className="flex items-center gap-3 rounded-xl p-3 outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      href={href}
    >
      <ItemTile icon={icon} name={name} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
          {name}
          {badge}
        </span>
        {description ? (
          <span className="truncate text-muted-foreground text-sm">
            {description}
          </span>
        ) : null}
      </span>
    </a>
  </li>
);

const CatalogGroup = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: ReactNode;
}) => (
  <section className="flex flex-col gap-1">
    <h2 className="px-3 font-medium text-muted-foreground text-sm">{title}</h2>
    <ul className="grid gap-1 sm:grid-cols-2">{children}</ul>
  </section>
);

const NothingFound = () => (
  <p className="px-3 text-muted-foreground text-sm">
    <Trans>Nothing matches that.</Trans>
  </p>
);

const ServerState = ({ server }: { readonly server: Connector }) => {
  if (server.lock?.type === "required") {
    return (
      <Badge variant="secondary">
        <Trans>Required</Trans>
      </Badge>
    );
  }
  if (server.availability.state !== "available") {
    return <Availability server={server} />;
  }
  return server.enabled ? (
    <Badge variant="outline">
      <Trans>On</Trans>
    </Badge>
  ) : null;
};

const McpCatalog = () => {
  const { t } = useLingui();
  const terms = useTerms();
  const { label, singular } = terms.mcp;
  const list = useCustomizeServers();
  const [needle, setNeedle] = useState("");
  return (
    <div className={pageClass}>
      <CatalogHeader
        action={
          list.data?.userServers.allowed ? (
            <a
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={routes.libraryNew("mcp_server")}
            >
              <PlusIcon data-icon="inline-start" />
              <Trans>Add a {singular}</Trans>
            </a>
          ) : null
        }
        description={
          <Trans>
            {label} give chats extra tools. Open one to see what it does, try
            it, or manage it.
          </Trans>
        }
        title={label}
      >
        <SearchBox
          label={t`Search ${label}`}
          onChange={setNeedle}
          value={needle}
        />
      </CatalogHeader>
      <QueryState query={list} skeleton={4}>
        {(data) => {
          const shown = data.connectors.filter((server) =>
            matches(needle, server.title, server.description)
          );
          const groups = [
            {
              id: "instance",
              servers: shown.filter((server) => server.source === "instance"),
              title: <Trans>From your administrator</Trans>,
            },
            {
              id: "library",
              servers: shown.filter((server) => server.source === "library"),
              title: <Trans>Yours and shared with you</Trans>,
            },
          ].filter((group) => group.servers.length > 0);
          if (data.connectors.length === 0) {
            return (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>
                    <Trans>No {label} yet</Trans>
                  </EmptyTitle>
                  <EmptyDescription>
                    <Trans>Your administrator hasn't set up any {label}.</Trans>
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            );
          }
          return groups.length === 0 ? (
            <NothingFound />
          ) : (
            groups.map((group) => (
              <CatalogGroup key={group.id} title={group.title}>
                {group.servers.map((server) => (
                  <CatalogRow
                    badge={<ServerState server={server} />}
                    description={server.description}
                    href={routes.customizeItem(terms, "mcp", server.id)}
                    key={server.id}
                    name={server.title}
                  />
                ))}
              </CatalogGroup>
            ))
          );
        }}
      </QueryState>
    </div>
  );
};

const SkillSource = ({
  source,
}: {
  readonly source: CustomizeSkill["source"];
}) => {
  switch (source) {
    case "mine":
      return <Trans>Yours</Trans>;
    case "shared":
      return <Trans>Shared with you</Trans>;
    case "libraries":
      return <Trans>From a space</Trans>;
    default:
      return source satisfies never;
  }
};

const SkillsCatalog = () => {
  const { t } = useLingui();
  const terms = useTerms();
  const { pending, skills } = useCustomizeSkills();
  const [needle, setNeedle] = useState("");
  const shown = skills.filter(({ item }) =>
    matches(needle, item.name, item.description)
  );
  const sources = (["mine", "shared", "libraries"] as const)
    .map((source) => ({
      skills: shown.filter((skill) => skill.source === source),
      source,
    }))
    .filter((group) => group.skills.length > 0);
  let body: ReactNode;
  if (pending) {
    body = <Skeleton className="h-16 w-full" />;
  } else if (skills.length === 0) {
    body = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>
            <Trans>No skills yet</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>
              A skill is instructions a chat can follow when you pick it. Make
              one, or ask someone to share theirs.
            </Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (sources.length === 0) {
    body = <NothingFound />;
  } else {
    body = sources.map((group) => (
      <CatalogGroup
        key={group.source}
        title={<SkillSource source={group.source} />}
      >
        {group.skills.map(({ item }) => (
          <CatalogRow
            description={item.description}
            href={routes.customizeItem(terms, "skills", item.id)}
            icon={item.icon}
            key={item.id}
            name={item.name}
          />
        ))}
      </CatalogGroup>
    ));
  }
  return (
    <div className={pageClass}>
      <CatalogHeader
        action={
          <a
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={routes.libraryNew("skill")}
          >
            <PlusIcon data-icon="inline-start" />
            <Trans>New skill</Trans>
          </a>
        }
        description={
          <Trans>
            Instructions a chat follows when you pick them. Open one to try it
            or change it.
          </Trans>
        }
        title={t`Skills`}
      >
        <SearchBox
          label={t`Search skills`}
          onChange={setNeedle}
          value={needle}
        />
      </CatalogHeader>
      {body}
    </div>
  );
};

/** The item page's head: the big tile, the name, where it's from, the actions. */
const ItemHeader = ({
  actions,
  icon,
  name,
  source,
}: {
  readonly actions: ReactNode;
  readonly icon?: string | null;
  readonly name: string;
  readonly source: ReactNode;
}) => (
  <header className="flex flex-col gap-4">
    <ItemTile icon={icon} name={name} size="lg" />
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-semibold text-2xl">{name}</h1>
        <p className="text-muted-foreground text-sm">{source}</p>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  </header>
);

const InfoTable = ({
  rows,
}: {
  readonly rows: readonly {
    readonly id: string;
    readonly label: ReactNode;
    readonly value: ReactNode;
  }[];
}) => (
  <section className="flex flex-col gap-2">
    <h2 className="font-medium text-lg">
      <Trans>Information</Trans>
    </h2>
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-6 gap-y-3 border-t pt-4 text-sm">
      {rows.map((row) => (
        <div className="contents" key={row.id}>
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

const ManageLink = ({ href }: { readonly href: string }) => (
  <a className={buttonVariants({ variant: "outline" })} href={href}>
    <SettingsIcon data-icon="inline-start" />
    <Trans>Manage</Trans>
  </a>
);

const TryNowButton = ({ onClick }: { readonly onClick: () => void }) => (
  <Button onClick={onClick}>
    <NewChatIcon data-icon="inline-start" />
    <Trans>Try now</Trans>
  </Button>
);

const ToolsCount = ({ server }: { readonly server: Connector }) => {
  const { query } = useApi();
  const tools = useQuery(
    query.connectors.tools.queryOptions({
      enabled: server.availability.state === "available",
      input: { id: server.id },
    })
  );
  if (server.availability.state !== "available" || tools.isError) {
    return <Trans>Unknown</Trans>;
  }
  if (!tools.data) {
    return <Skeleton className="h-4 w-12" />;
  }
  if (!tools.data.reachable) {
    return <Trans>Couldn't reach it</Trans>;
  }
  const count = tools.data.tools.length;
  return <Plural one="# tool" other="# tools" value={count} />;
};

const transportLabel = (transport: Connector["transport"]): ReactNode => {
  switch (transport) {
    case "http":
      return <Trans>Streamable HTTP</Trans>;
    case "sse":
      return <Trans>Server-sent events</Trans>;
    case "stdio":
      return <Trans>Local (desktop app)</Trans>;
    default:
      return transport satisfies never;
  }
};

const McpItem = ({ id }: { readonly id: LibraryItemId }) => {
  const { t } = useLingui();
  const terms = useTerms();
  const tryNow = useTryNow();
  const list = useCustomizeServers();
  const server = list.data?.connectors.find((each) => each.id === id);
  const start = useCallback(() => {
    if (server) {
      const { title } = server;
      tryNow({
        href: routes.newChatWithMcp(server.id),
        text: t`What can you help me with using ${title}?`,
      });
    }
  }, [server, t, tryNow]);
  const parent = {
    href: routes.customizeKind(terms, "mcp"),
    label: terms.mcp.label,
  };
  if (list.isPending) {
    return <Skeleton className="mx-auto h-40 w-full max-w-3xl" />;
  }
  if (!server) {
    return <Missing parent={parent} />;
  }
  const usable = server.availability.state === "available";
  return (
    <div className={pageClass}>
      <Crumbs current={server.title} parent={parent} />
      <ItemHeader
        actions={
          <>
            <ManageLink href={routes.customizeManage(terms, server.id)} />
            {usable ? <TryNowButton onClick={start} /> : null}
          </>
        }
        name={server.title}
        source={
          server.source === "instance" ? (
            <Trans>From your administrator</Trans>
          ) : (
            <Trans>From your library</Trans>
          )
        }
      />
      {server.description ? <p>{server.description}</p> : null}
      <LockNote server={server} />
      <InfoTable
        rows={[
          {
            id: "source",
            label: <Trans>Source</Trans>,
            value:
              server.source === "instance" ? (
                <Trans>Your administrator's catalog</Trans>
              ) : (
                <Trans>Your library</Trans>
              ),
          },
          {
            id: "status",
            label: <Trans>Status</Trans>,
            value: server.enabled ? (
              <Trans>On in new chats</Trans>
            ) : (
              <Trans>Off in new chats</Trans>
            ),
          },
          {
            id: "transport",
            label: <Trans>Transport</Trans>,
            value: transportLabel(server.transport),
          },
          {
            id: "auth",
            label: <Trans>Sign-in</Trans>,
            value:
              server.auth === "oauth" ? (
                <Trans>Each person signs in</Trans>
              ) : (
                <Trans>None needed</Trans>
              ),
          },
          {
            id: "tools",
            label: <Trans>Tools</Trans>,
            value: <ToolsCount server={server} />,
          },
        ]}
      />
    </div>
  );
};

const SkillItem = ({ id }: { readonly id: LibraryItemId }) => {
  const { i18n, t } = useLingui();
  const terms = useTerms();
  const tryNow = useTryNow();
  const { pending, skills } = useCustomizeSkills();
  const found = skills.find((skill) => skill.item.id === id);
  const start = useCallback(() => {
    if (found) {
      const { name } = found.item;
      tryNow({
        href: routes.home,
        skill: { id: found.item.id, name },
        text: t`Show me what the ${name} skill can do.`,
      });
    }
  }, [found, t, tryNow]);
  const parent = {
    href: routes.customizeKind(terms, "skills"),
    label: t`Skills`,
  };
  if (pending) {
    return <Skeleton className="mx-auto h-40 w-full max-w-3xl" />;
  }
  if (!found) {
    return <Missing parent={parent} />;
  }
  const { item, source } = found;
  return (
    <div className={pageClass}>
      <Crumbs current={item.name} parent={parent} />
      <ItemHeader
        actions={
          <>
            {/* A skill's controls are its library page: instructions, versions, sharing. */}
            <ManageLink href={routes.libraryItem(item.id)} />
            <TryNowButton onClick={start} />
          </>
        }
        icon={item.icon}
        name={item.name}
        source={<SkillSource source={source} />}
      />
      {item.description ? <p>{item.description}</p> : null}
      <InfoTable
        rows={[
          {
            id: "source",
            label: <Trans>Source</Trans>,
            value: <SkillSource source={source} />,
          },
          {
            id: "version",
            label: <Trans>Version</Trans>,
            value: item.latestVersionNumber ?? "—",
          },
          {
            id: "updated",
            label: <Trans>Updated</Trans>,
            value: i18n.date(item.updatedAt, { dateStyle: "medium" }),
          },
        ]}
      />
    </div>
  );
};

/** Manage (193): the server's own controls, the page settings opens too (188). */
const McpManage = ({ id }: { readonly id: LibraryItemId }) => {
  const terms = useTerms();
  const router = useRouter();
  const list = useCustomizeServers();
  const { failed, onToggle, pendingId } = useMcpToggle();
  const server = list.data?.connectors.find((each) => each.id === id);
  const back = useCallback(
    () => router.push(routes.customizeItem(terms, "mcp", id)),
    [id, router, terms]
  );
  const parent = {
    href: routes.customizeKind(terms, "mcp"),
    label: terms.mcp.label,
  };
  if (list.isPending) {
    return <Skeleton className="mx-auto h-40 w-full max-w-3xl" />;
  }
  if (!server) {
    return <Missing parent={parent} />;
  }
  return (
    <div className={pageClass}>
      {failed ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>That change couldn't be saved. Try again.</Trans>
        </p>
      ) : null}
      <ServerDetail
        backLabel={server.title}
        onBack={back}
        onToggle={onToggle}
        pending={pendingId === server.id}
        server={server}
      />
    </div>
  );
};

const Missing = ({
  parent,
}: {
  readonly parent: { readonly href: string; readonly label: string };
}) => (
  <Empty className="mx-auto max-w-3xl border">
    <EmptyHeader>
      <EmptyTitle>
        <Trans>Not found</Trans>
      </EmptyTitle>
      <EmptyDescription>
        <Trans>
          It may have been removed, or it isn't available to you.{" "}
          <a className="underline underline-offset-4" href={parent.href}>
            Back to {parent.label}
          </a>
        </Trans>
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const viewOf = (view: CustomizeView, mcpParent: string): ReactNode => {
  switch (view.view) {
    case "catalog":
      return view.kind === "mcp" ? <McpCatalog /> : <SkillsCatalog />;
    case "item":
      return view.kind === "mcp" ? (
        <McpItem id={view.id} />
      ) : (
        <SkillItem id={view.id} />
      );
    case "manage":
      return <McpManage id={view.id} />;
    case "not-found":
      return <Missing parent={{ href: routes.customize, label: mcpParent }} />;
    default:
      return view satisfies never;
  }
};

export const CustomizeScreen = ({
  segments,
}: {
  readonly segments: readonly string[];
}) => {
  const terms = useTerms();
  const view = useMemo(
    () => customizeViewFromPath(segments, terms),
    [segments, terms]
  );
  return viewOf(view, terms.mcp.label);
};

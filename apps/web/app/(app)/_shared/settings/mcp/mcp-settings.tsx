"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Connector,
  ConnectorList,
  ConnectorTool,
} from "@workspace/contract/schemas/library";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  LockIcon,
  MonitorIcon,
  NetworkIcon,
  PlusIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { useTerms } from "@/app/(app)/_shared/terms";
import { routes } from "@/lib/routes";

// MCP servers (184), under whatever name `terms.mcp` gives them (191): the
// servers this user can use. The operator's
// catalog (app.config.yaml) comes first, with required or fixed ones
// locked and the reason shown; then the user's own and shared servers,
// and "Add your own" when the instance allows it. The merge happens on the
// server (`effectiveMcpServers`); this only renders it and flips switches.
// A section of the full-screen settings (185). Links are plain anchors:
// next/link can't load in the browser test runner, and leaving settings for
// the library is a full page anyway.
//
// Tools (188): a row opens the server's own page (after ChatGPT's plugin
// pages), with its tools listed from the server's `tools/list` (cached per
// connection) only when opened, less any
// the operator denies; required ones are locked on. A switch here is the
// user's default for every chat; a chat can still differ (the composer).

const OAuthStatus = ({ server }: { readonly server: Connector }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const { id } = server;
  const status = useQuery(query.mcp.status.queryOptions({ input: { id } }));
  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: query.mcp.status.key({ input: { id } }),
      }),
    [id, query, queryClient]
  );
  const start = useMutation(query.mcp.startOAuth.mutationOptions());
  const disconnect = useMutation(
    query.mcp.disconnect.mutationOptions({ onSettled: refresh })
  );
  const { mutate: startOAuth } = start;
  const { mutate: signOut } = disconnect;
  const onConnect = useCallback(
    () =>
      startOAuth(
        { id },
        {
          onSuccess: ({ authorizationUrl }) =>
            window.open(authorizationUrl, "_blank", "noopener"),
        }
      ),
    [id, startOAuth]
  );
  const onDisconnect = useCallback(() => signOut({ id }), [id, signOut]);

  if (status.isPending) {
    return <Skeleton className="h-7 w-24" />;
  }
  if (status.isError || status.data.state === "error") {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon data-icon="inline-start" />
        <Trans>Unreachable</Trans>
      </Badge>
    );
  }
  if (status.data.state === "connected") {
    return (
      <Button
        disabled={disconnect.isPending}
        onClick={onDisconnect}
        size="sm"
        variant="ghost"
      >
        <Trans>Disconnect</Trans>
      </Button>
    );
  }
  return (
    <Button
      disabled={start.isPending}
      onClick={onConnect}
      size="sm"
      variant="outline"
    >
      <Trans>Connect</Trans>
    </Button>
  );
};

const Availability = ({ server }: { readonly server: Connector }) => {
  const { availability } = server;
  switch (availability.state) {
    case "available":
      return null;
    case "desktop_only":
      return (
        <Badge variant="outline">
          <MonitorIcon data-icon="inline-start" />
          <Trans>Desktop app only</Trans>
        </Badge>
      );
    case "unconfigured":
      return (
        <Badge variant="outline">
          <CircleAlertIcon data-icon="inline-start" />
          <Trans>Needs setup by your administrator</Trans>
        </Badge>
      );
    default:
      return availability satisfies never;
  }
};

const LockNote = ({ server }: { readonly server: Connector }) => {
  const { lock } = server;
  if (!lock) {
    return null;
  }
  const { reason } = lock;
  let note: ReactNode;
  if (reason) {
    note = reason;
  } else if (lock.type === "required") {
    note = <Trans>Required by your administrator</Trans>;
  } else {
    note = <Trans>Set by your administrator</Trans>;
  }
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <LockIcon className="size-3.5 shrink-0" />
      {note}
    </p>
  );
};

const ToolRow = ({
  server,
  tool,
}: {
  readonly server: Connector;
  readonly tool: ConnectorTool;
}) => {
  const { t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const { id } = server;
  const { mutate, isPending } = useMutation(
    query.connectors.setToolEnabled.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: query.connectors.key() }),
    })
  );
  const toggle = useCallback(
    (enabled: boolean) => mutate({ enabled, id, tool: tool.name }),
    [id, mutate, tool.name]
  );
  const { name } = tool;
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 font-medium text-sm">
          {name}
          {tool.lock ? (
            <LockIcon
              aria-label={t`Required by your administrator`}
              className="size-3.5 text-muted-foreground"
            />
          ) : null}
        </span>
        {tool.description ? (
          <span className="line-clamp-2 text-muted-foreground text-sm">
            {tool.description}
          </span>
        ) : null}
      </div>
      <Switch
        aria-label={t`Use the ${name} tool`}
        checked={tool.enabled}
        disabled={tool.lock !== null || !server.enabled || isPending}
        onCheckedChange={toggle}
      />
    </li>
  );
};

const ToolNote = ({ children }: { readonly children: ReactNode }) => (
  <p className="px-4 py-6 text-center text-muted-foreground text-sm">
    {children}
  </p>
);

const ToolList = ({ server }: { readonly server: Connector }) => {
  const { query } = useApi();
  const { singular } = useTerms().mcp;
  const tools = useQuery(
    query.connectors.tools.queryOptions({
      input: { id: server.id },
      staleTime: 60_000,
    })
  );
  if (tools.isPending) {
    return (
      <div aria-hidden className="flex flex-col gap-3 px-4 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }
  if (tools.isError || !tools.data.reachable) {
    return (
      <ToolNote>
        {server.auth === "oauth" ? (
          <Trans>Connect to see this {singular}'s tools.</Trans>
        ) : (
          <Trans>Couldn't reach this {singular} to list its tools.</Trans>
        )}
      </ToolNote>
    );
  }
  if (tools.data.tools.length === 0) {
    return (
      <ToolNote>
        <Trans>This {singular} has no tools.</Trans>
      </ToolNote>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {tools.data.tools.map((tool) => (
        <ToolRow key={tool.name} server={server} tool={tool} />
      ))}
    </ul>
  );
};

/** The server's tile: its first letter, so a long list scans by shape. */
const ServerTile = ({
  server,
  size = "sm",
}: {
  readonly server: Connector;
  readonly size?: "sm" | "lg";
}) => (
  <span
    aria-hidden
    className={cn(
      "flex shrink-0 items-center justify-center rounded-lg border bg-muted font-medium text-muted-foreground uppercase",
      size === "lg" ? "size-12 rounded-xl text-lg" : "size-9 text-sm"
    )}
  >
    {server.title.slice(0, 1)}
  </span>
);

const ServerSwitch = ({
  onToggle,
  pending,
  server,
}: {
  readonly onToggle: (server: Connector, enabled: boolean) => void;
  readonly pending: boolean;
  readonly server: Connector;
}) => {
  const { t } = useLingui();
  const { title } = server;
  const toggle = useCallback(
    (enabled: boolean) => onToggle(server, enabled),
    [server, onToggle]
  );
  // "Needs setup" can't be used whatever the user chose, so it reads as off.
  const unconfigured = server.availability.state === "unconfigured";
  return (
    <Switch
      aria-label={t`Use ${title} in chats`}
      checked={server.enabled && !unconfigured}
      disabled={server.lock !== null || unconfigured || pending}
      onCheckedChange={toggle}
    />
  );
};

/** What's off, in a word: shown under a server in the list. */
const ToolsSummary = ({ server }: { readonly server: Connector }) => {
  const off = server.disabledTools.length;
  return off > 0 ? (
    <span className="text-muted-foreground text-xs">
      <Plural one="# tool off" other="# tools off" value={off} />
    </span>
  ) : null;
};

/**
 * One server, the way an app store shows an app (after ChatGPT's plugin
 * page): who it's from, what it does, its state, then its tools, each with
 * its own switch. Opened from the list; Back returns to it.
 */
const ServerDetail = ({
  onBack,
  onToggle,
  pending,
  server,
}: {
  readonly onBack: () => void;
  readonly onToggle: (server: Connector, enabled: boolean) => void;
  readonly pending: boolean;
  readonly server: Connector;
}) => {
  const { label } = useTerms().mcp;
  const available = server.availability.state === "available";
  return (
    <div className="flex flex-col gap-6">
      <Button
        className="-ms-2 self-start"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <ChevronLeftIcon />
        {label}
      </Button>
      <header className="flex items-start gap-4">
        <ServerTile server={server} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium text-xl">{server.title}</h2>
            {server.lock?.type === "required" ? (
              <Badge variant="secondary">
                <Trans>Required</Trans>
              </Badge>
            ) : null}
            <Availability server={server} />
          </div>
          <p className="text-muted-foreground text-sm">
            {server.source === "instance" ? (
              <Trans>From your administrator</Trans>
            ) : (
              <a
                className="underline-offset-4 hover:underline"
                href={routes.libraryItem(server.id)}
              >
                <Trans>From your library</Trans>
              </a>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {server.auth === "oauth" && server.enabled && available ? (
            <OAuthStatus server={server} />
          ) : null}
          <ServerSwitch onToggle={onToggle} pending={pending} server={server} />
        </div>
      </header>
      {server.description ? (
        <p className="text-sm">{server.description}</p>
      ) : null}
      {server.availability.state === "unconfigured" ? (
        <p className="text-muted-foreground text-sm">
          {server.availability.message}
        </p>
      ) : null}
      <LockNote server={server} />
      {available ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-muted-foreground text-sm">
            <Trans>Tools</Trans>
          </h3>
          <div className="rounded-lg border">
            <ToolList server={server} />
          </div>
        </section>
      ) : null}
    </div>
  );
};

const ServerRow = ({
  onOpen,
  onToggle,
  pending,
  server,
}: {
  readonly onOpen: (server: Connector) => void;
  readonly onToggle: (server: Connector, enabled: boolean) => void;
  readonly pending: boolean;
  readonly server: Connector;
}) => {
  const { t } = useLingui();
  const { title } = server;
  const open = useCallback(() => onOpen(server), [onOpen, server]);
  const available = server.availability.state === "available";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <button
        aria-label={t`Open ${title}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={open}
        type="button"
      >
        <ServerTile server={server} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            {server.lock?.type === "required" ? (
              <Badge variant="secondary">
                <Trans>Required</Trans>
              </Badge>
            ) : null}
            <Availability server={server} />
          </span>
          {server.description ? (
            <span className="truncate text-muted-foreground text-sm">
              {server.description}
            </span>
          ) : null}
          <ToolsSummary server={server} />
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
        />
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {server.auth === "oauth" && server.enabled && available ? (
          <OAuthStatus server={server} />
        ) : null}
        <ServerSwitch onToggle={onToggle} pending={pending} server={server} />
      </div>
    </li>
  );
};

const ServerGroup = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: ReactNode;
}) => (
  <section className="flex flex-col gap-2">
    <h2 className="font-medium text-muted-foreground text-sm">{title}</h2>
    <ul className="flex flex-col divide-y divide-border rounded-lg border">
      {children}
    </ul>
  </section>
);

const McpBody = ({ list }: { readonly list: ConnectorList }) => {
  const { query } = useApi();
  const { label, singular } = useTerms().mcp;
  const queryClient = useQueryClient();
  const listKey = query.connectors.list.queryKey({ input: {} });
  const setEnabled = useMutation(
    query.connectors.setEnabled.mutationOptions({
      onSuccess: (saved) =>
        queryClient.setQueryData<ConnectorList>(listKey, (current) =>
          current
            ? {
                ...current,
                connectors: current.connectors.map((item) =>
                  item.id === saved.id ? saved : item
                ),
              }
            : current
        ),
    })
  );
  const { mutate } = setEnabled;
  const onToggle = useCallback(
    (server: Connector, enabled: boolean) => mutate({ enabled, id: server.id }),
    [mutate]
  );
  const pendingId = setEnabled.isPending ? setEnabled.variables?.id : null;
  const [openId, setOpenId] = useState<Connector["id"] | null>(null);
  const openServer = useCallback(
    (server: Connector) => setOpenId(server.id),
    []
  );
  const back = useCallback(() => setOpenId(null), []);
  const opened = list.connectors.find((each) => each.id === openId);
  if (opened) {
    return (
      <ServerDetail
        onBack={back}
        onToggle={onToggle}
        pending={pendingId === opened.id}
        server={opened}
      />
    );
  }

  const instance = list.connectors.filter((c) => c.source === "instance");
  const library = list.connectors.filter((c) => c.source === "library");
  const { allowed } = list.userServers;

  if (list.connectors.length === 0 && !allowed) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <NetworkIcon />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>No {label} yet</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>
              Your administrator hasn't set up any {label}, and adding your own
              is turned off.
            </Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {setEnabled.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>That change couldn't be saved. Try again.</Trans>
        </p>
      ) : null}
      {instance.length > 0 ? (
        <ServerGroup title={<Trans>From your administrator</Trans>}>
          {instance.map((server) => (
            <ServerRow
              key={server.id}
              onOpen={openServer}
              onToggle={onToggle}
              pending={pendingId === server.id}
              server={server}
            />
          ))}
        </ServerGroup>
      ) : null}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium text-muted-foreground text-sm">
            <Trans>Yours and shared with you</Trans>
          </h2>
          {allowed ? (
            <a
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={routes.libraryNew("mcp_server")}
            >
              <PlusIcon data-icon="inline-start" />
              <Trans>Add your own</Trans>
            </a>
          ) : null}
        </div>
        {library.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border">
            {library.map((server) => (
              <ServerRow
                key={server.id}
                onOpen={openServer}
                onToggle={onToggle}
                pending={pendingId === server.id}
                server={server}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-muted-foreground text-sm">
            {allowed ? (
              <Trans>
                Add a {singular} by its URL to give chats more tools. Only you
                can use it until you share it.
              </Trans>
            ) : (
              <Trans>Your administrator doesn't allow adding {label}.</Trans>
            )}
          </p>
        )}
      </section>
    </div>
  );
};

export const McpSettings = () => {
  const { query } = useApi();
  const list = useQuery(query.connectors.list.queryOptions({ input: {} }));
  return (
    <QueryState query={list} skeleton={3}>
      {(data) => <McpBody list={data} />}
    </QueryState>
  );
};

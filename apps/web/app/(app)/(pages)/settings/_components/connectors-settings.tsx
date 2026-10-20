"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Connector,
  ConnectorList,
} from "@workspace/contract/schemas/library";
import {
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
import { type ReactNode, useCallback } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { routes } from "@/lib/routes";

// Connectors (184): the MCP servers this user can use. The operator's
// catalog (app.config.yaml) comes first, with required or fixed ones
// locked and the reason shown; then the user's own and shared servers,
// and "Add your own" when the instance allows it. The merge happens on the
// server (`effectiveConnectors`); this only renders it and flips switches.
// Links are plain anchors: next/link can't load in the browser test runner,
// and leaving settings for the library is a full page anyway.

const OAuthStatus = ({ connector }: { readonly connector: Connector }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const { id } = connector;
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

const Availability = ({ connector }: { readonly connector: Connector }) => {
  const { availability } = connector;
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

const LockNote = ({ connector }: { readonly connector: Connector }) => {
  const { lock } = connector;
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

const ConnectorRow = ({
  connector,
  onToggle,
  pending,
}: {
  readonly connector: Connector;
  readonly onToggle: (connector: Connector, enabled: boolean) => void;
  readonly pending: boolean;
}) => {
  const { t } = useLingui();
  const { title } = connector;
  const toggle = useCallback(
    (enabled: boolean) => onToggle(connector, enabled),
    [connector, onToggle]
  );
  const available = connector.availability.state === "available";
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <NetworkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">
            {connector.source === "library" ? (
              <a
                className="underline-offset-4 hover:underline"
                href={routes.libraryItem(connector.id)}
              >
                {title}
              </a>
            ) : (
              title
            )}
          </span>
          {connector.lock?.type === "required" ? (
            <Badge variant="secondary">
              <Trans>Required</Trans>
            </Badge>
          ) : null}
          <Availability connector={connector} />
        </div>
        {connector.description ? (
          <p className="text-muted-foreground text-sm">
            {connector.description}
          </p>
        ) : null}
        {connector.availability.state === "unconfigured" ? (
          <p className="text-muted-foreground text-xs">
            {connector.availability.message}
          </p>
        ) : null}
        <LockNote connector={connector} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {connector.auth === "oauth" && connector.enabled && available ? (
          <OAuthStatus connector={connector} />
        ) : null}
        <Switch
          aria-label={t`Use ${title} in chats`}
          checked={connector.enabled}
          disabled={
            connector.lock !== null ||
            connector.availability.state === "unconfigured" ||
            pending
          }
          onCheckedChange={toggle}
        />
      </div>
    </li>
  );
};

const ConnectorGroup = ({
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

const ConnectorsBody = ({ list }: { readonly list: ConnectorList }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const listKey = query.connectors.list.queryKey();
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
    (connector: Connector, enabled: boolean) =>
      mutate({ enabled, id: connector.id }),
    [mutate]
  );
  const pendingId = setEnabled.isPending ? setEnabled.variables?.id : null;

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
            <Trans>No connectors yet</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>
              Your administrator hasn't set up any connectors, and adding your
              own is turned off.
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
        <ConnectorGroup title={<Trans>From your administrator</Trans>}>
          {instance.map((connector) => (
            <ConnectorRow
              connector={connector}
              key={connector.id}
              onToggle={onToggle}
              pending={pendingId === connector.id}
            />
          ))}
        </ConnectorGroup>
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
            {library.map((connector) => (
              <ConnectorRow
                connector={connector}
                key={connector.id}
                onToggle={onToggle}
                pending={pendingId === connector.id}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-muted-foreground text-sm">
            {allowed ? (
              <Trans>
                Add an MCP server by its URL to give chats more tools. Only you
                can use it until you share it.
              </Trans>
            ) : (
              <Trans>Your administrator doesn't allow adding servers.</Trans>
            )}
          </p>
        )}
      </section>
    </div>
  );
};

export const ConnectorsSettings = () => {
  const { query } = useApi();
  const list = useQuery(query.connectors.list.queryOptions());
  return (
    <QueryState query={list} skeleton={3}>
      {(data) => <ConnectorsBody list={data} />}
    </QueryState>
  );
};

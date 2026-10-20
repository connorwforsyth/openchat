"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  Connector,
  ConnectorTool,
} from "@workspace/contract/schemas/library";
import { LockIcon, NetworkIcon, RotateCcwIcon } from "@workspace/icons";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useCallback, useEffect } from "react";

import { usableConnectors } from "../connectors";
import type { ComposerConnectors } from "../props";

// The + menu's Connectors submenu (188): every connector this chat can use,
// each a submenu with its own switch and its tools'. Changes are this
// chat's only; "Reset to my defaults" drops them. The host saves each
// change and passes the new state back, so nothing here is optimistic.

const SUBMENU_CLASS = "max-h-80 w-64 max-w-[calc(100vw-2rem)]";

function ToolItem({
  connector,
  onToggleTool,
  tool,
}: {
  readonly connector: Connector;
  readonly onToggleTool: ComposerConnectors["onToggleTool"];
  readonly tool: ConnectorTool;
}) {
  const { t } = useLingui();
  const toggle = useCallback(
    (on: boolean) => onToggleTool(connector.id, tool.name, on),
    [connector.id, onToggleTool, tool.name]
  );
  const locked = tool.lock !== null;
  return (
    <DropdownMenuCheckboxItem
      checked={tool.enabled}
      closeOnClick={false}
      disabled={locked || !connector.enabled}
      label={tool.name}
      onCheckedChange={toggle}
    >
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1 truncate font-mono text-xs">
          {tool.name}
          {locked ? (
            <LockIcon
              aria-label={t`Required by your administrator`}
              className="size-3"
            />
          ) : null}
        </span>
        {tool.description ? (
          <span className="truncate text-muted-foreground text-xs">
            {tool.description}
          </span>
        ) : null}
      </span>
    </DropdownMenuCheckboxItem>
  );
}

function ToolList({
  connector,
  connectors,
}: {
  readonly connector: Connector;
  readonly connectors: ComposerConnectors;
}) {
  const list = connectors.tools[connector.id];
  const { onWantTools } = connectors;
  const { id } = connector;
  // Mounted only while the connector's submenu is open: the list is
  // fetched when someone looks, not for every connector up front.
  useEffect(() => {
    onWantTools(id);
  }, [id, onWantTools]);
  if (!list) {
    return (
      <div className="flex flex-col gap-1 p-1.5" role="presentation">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }
  if (!list.reachable) {
    return (
      <p className="px-1.5 py-1 text-muted-foreground text-xs">
        <Trans>Couldn't reach this connector to list its tools.</Trans>
      </p>
    );
  }
  if (list.tools.length === 0) {
    return (
      <p className="px-1.5 py-1 text-muted-foreground text-xs">
        <Trans>No tools.</Trans>
      </p>
    );
  }
  return (
    <>
      {list.tools.map((tool) => (
        <ToolItem
          connector={connector}
          key={tool.name}
          onToggleTool={connectors.onToggleTool}
          tool={tool}
        />
      ))}
    </>
  );
}

function ConnectorSub({
  connector,
  connectors,
}: {
  readonly connector: Connector;
  readonly connectors: ComposerConnectors;
}) {
  const { onToggle } = connectors;
  const { id } = connector;
  const toggle = useCallback((on: boolean) => onToggle(id, on), [id, onToggle]);
  const off = connector.disabledTools.length;
  let state: string | null = null;
  if (!connector.enabled) {
    state = "off";
  } else if (off > 0) {
    state = "some";
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">{connector.title}</span>
          {connector.customized ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          ) : null}
          {state ? (
            <span className="ms-auto shrink-0 ps-2 text-muted-foreground text-xs">
              {state === "off" ? <Trans>Off</Trans> : <Trans>{off} off</Trans>}
            </span>
          ) : null}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={SUBMENU_CLASS}>
        <DropdownMenuCheckboxItem
          checked={connector.enabled}
          closeOnClick={false}
          disabled={connector.lock !== null}
          onCheckedChange={toggle}
        >
          <span className="flex min-w-0 flex-col">
            <Trans>Use in this chat</Trans>
            {connector.lock ? (
              <span className="text-muted-foreground text-xs">
                {connector.lock.reason ?? (
                  <Trans>Set by your administrator</Trans>
                )}
              </span>
            ) : null}
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Tools</Trans>
          </DropdownMenuLabel>
          <ToolList connector={connector} connectors={connectors} />
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The Connectors entry of the + menu; nothing when the chat has none to use. */
export function ConnectorsMenu({
  connectors,
}: {
  readonly connectors: ComposerConnectors;
}) {
  const usable = usableConnectors(connectors.connectors);
  if (usable.length === 0) {
    return null;
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <NetworkIcon aria-hidden />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Trans>Connectors</Trans>
          {connectors.customized ? (
            <span className="ms-auto text-muted-foreground text-xs">
              <Trans>This chat</Trans>
            </span>
          ) : null}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={SUBMENU_CLASS}>
        {usable.map((connector) => (
          <ConnectorSub
            connector={connector}
            connectors={connectors}
            key={connector.id}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!connectors.customized}
          onClick={connectors.onReset}
        >
          <RotateCcwIcon aria-hidden />
          <Trans>Reset to my defaults</Trans>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { Connector } from "@workspace/contract/schemas/library";
import { LockIcon, NetworkIcon, RotateCcwIcon } from "@workspace/icons";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSwitchItem,
} from "@workspace/ui/components/dropdown-menu";
import { useCallback } from "react";

import { usableMcpServers } from "../mcp";
import type { ComposerMcp } from "../props";

// The + menu's MCP submenu (188), titled with the configured term (191):
// two levels only, + then a flat list of this chat's servers, each a switch
// for this chat, then "Reset to my defaults". Which of a server's tools are
// on is a settings matter, not a per-message one. The host saves each change
// and passes the new state back, so nothing here is optimistic.

const SUBMENU_CLASS = "max-h-80 w-64 max-w-[calc(100vw-2rem)]";

function ServerSwitch({
  onToggle,
  server,
}: {
  readonly onToggle: ComposerMcp["onToggle"];
  readonly server: Connector;
}) {
  const { t } = useLingui();
  const { id } = server;
  const toggle = useCallback((on: boolean) => onToggle(id, on), [id, onToggle]);
  const locked = server.lock !== null;
  return (
    <DropdownMenuSwitchItem
      checked={server.enabled}
      closeOnClick={false}
      disabled={locked}
      label={server.title}
      onCheckedChange={toggle}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate">{server.title}</span>
        {server.customized ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        ) : null}
        {locked ? (
          <LockIcon
            aria-label={server.lock?.reason ?? t`Set by your administrator`}
            className="size-3 shrink-0 text-muted-foreground"
          />
        ) : null}
      </span>
    </DropdownMenuSwitchItem>
  );
}

/** The MCP entry of the + menu; nothing when the chat has none to use. */
export function McpMenu({ mcp }: { readonly mcp: ComposerMcp }) {
  const usable = usableMcpServers(mcp.servers);
  if (usable.length === 0) {
    return null;
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <NetworkIcon aria-hidden />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {mcp.term.label}
          {mcp.customized ? (
            <span className="ms-auto text-muted-foreground text-xs">
              <Trans>This chat</Trans>
            </span>
          ) : null}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={SUBMENU_CLASS}>
        {usable.map((server) => (
          <ServerSwitch
            key={server.id}
            onToggle={mcp.onToggle}
            server={server}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!mcp.customized} onClick={mcp.onReset}>
          <RotateCcwIcon aria-hidden />
          <Trans>Reset to my defaults</Trans>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

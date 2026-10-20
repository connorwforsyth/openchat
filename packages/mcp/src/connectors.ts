import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  Connector,
  ConnectorAvailability,
  UserServerPolicy,
} from "@workspace/contract/schemas/library";
import { err, ok, type Result } from "@workspace/shared/result";

import {
  type InstanceServerEntry,
  instanceServerId,
  missingSecrets,
} from "./server-config";

// Connectors (184): which MCP servers one user has on. Three layers, merged
// here and nowhere else:
//
// 1. the operator's catalog in app.config.yaml (`default: on | off |
//    required`, `allowUserOverride`);
// 2. the servers in the user's MCP Library (owned or shared with them);
// 3. the user's own on/off choices (`mcp_connector_pref`).
//
// Pure: the shell (`connector-service.ts`) loads the three and hands them in.

/** A library server as the merge needs it; no secrets, no URL. */
export interface LibraryConnector {
  readonly auth: Connector["auth"];
  readonly description: string;
  readonly id: LibraryItemId;
  readonly name: string;
  /** As stored; a transport this surface doesn't run reads as desktop-only. */
  readonly transport: string;
}

export interface ConnectorInputs {
  readonly catalog: readonly InstanceServerEntry[];
  readonly library: readonly LibraryConnector[];
  /** The user's stored choices by server id; absent means "the default". */
  readonly prefs: ReadonlyMap<LibraryItemId, boolean>;
  /** The server can't spawn stdio servers; the desktop app can. */
  readonly surface?: "desktop" | "server";
}

const availabilityOf = (
  transport: string,
  surface: "desktop" | "server",
  missing: readonly string[]
): ConnectorAvailability => {
  if (transport === "stdio" && surface === "server") {
    return { state: "desktop_only" };
  }
  if (missing.length > 0) {
    return {
      message: `Needs ${missing.join(", ")} set by the operator.`,
      state: "unconfigured",
    };
  }
  return { state: "available" };
};

const fromCatalog = (
  entry: InstanceServerEntry,
  prefs: ConnectorInputs["prefs"],
  surface: "desktop" | "server"
): Connector => {
  const id = instanceServerId(entry.name);
  const reason = entry.reason ?? null;
  const base = {
    auth:
      entry.transport !== "stdio" && entry.auth.type === "oauth"
        ? ("oauth" as const)
        : ("none" as const),
    availability: availabilityOf(
      entry.transport,
      surface,
      missingSecrets(entry)
    ),
    description: entry.description ?? null,
    id,
    name: entry.name,
    source: "instance" as const,
    title: entry.title ?? entry.name,
    transport: entry.transport,
  };
  if (entry.default === "required") {
    return { ...base, enabled: true, lock: { reason, type: "required" } };
  }
  const byDefault = entry.default === "on";
  if (!entry.allowUserOverride) {
    return { ...base, enabled: byDefault, lock: { reason, type: "operator" } };
  }
  return { ...base, enabled: prefs.get(id) ?? byDefault, lock: null };
};

const fromLibrary = (
  server: LibraryConnector,
  prefs: ConnectorInputs["prefs"],
  surface: "desktop" | "server"
): Connector => {
  const transport =
    server.transport === "http" || server.transport === "sse"
      ? server.transport
      : "stdio";
  return {
    auth: server.auth,
    availability: availabilityOf(transport, surface, []),
    description: server.description === "" ? null : server.description,
    enabled: prefs.get(server.id) ?? true,
    id: server.id,
    lock: null,
    name: server.name,
    source: "library",
    title: server.name,
    transport,
  };
};

/** The user's connectors: the catalog in config order, then their library. */
export const effectiveConnectors = ({
  catalog,
  library,
  prefs,
  surface = "server",
}: ConnectorInputs): readonly Connector[] => {
  const instance = catalog.map((entry) => fromCatalog(entry, prefs, surface));
  const taken = new Set(instance.map((connector) => connector.id));
  return [
    ...instance,
    ...library
      .filter((server) => !taken.has(server.id))
      .map((server) => fromLibrary(server, prefs, surface)),
  ];
};

const runnable = (connector: Connector): boolean =>
  connector.enabled && connector.availability.state === "available";

/** What a plain chat is offered: on, and runnable on this surface. */
export const enabledServerIds = (
  connectors: readonly Connector[]
): readonly LibraryItemId[] =>
  connectors.filter(runnable).map((connector) => connector.id);

/**
 * What every run must leave out, agent runs included: an agent listing a
 * server doesn't override the user (or the operator) turning it off.
 */
export const disabledServerIds = (
  connectors: readonly Connector[]
): ReadonlySet<LibraryItemId> =>
  new Set(
    connectors
      .filter((connector) => !runnable(connector))
      .map((connector) => connector.id)
  );

export interface ConnectorLocked {
  readonly type: "locked";
}

/** The connector after the user flips it, or why they can't. */
export const toggleConnector = (
  connector: Connector,
  enabled: boolean
): Result<Connector, ConnectorLocked> =>
  connector.lock ? err({ type: "locked" }) : ok({ ...connector, enabled });

const hostAllowed = (host: string, patterns: readonly string[]): boolean =>
  patterns.length === 0 ||
  patterns.some((pattern) =>
    pattern.startsWith("*.")
      ? host.endsWith(pattern.slice(1).toLowerCase())
      : host === pattern.toLowerCase()
  );

/**
 * Whether a user may save this server in their library under the
 * operator's `mcp.userServers` policy. The SSRF check (`checkServerUrl`)
 * still runs on every connect; this is the operator's narrower rule.
 */
export const checkUserServer = (
  policy: UserServerPolicy,
  server: { readonly transport: string; readonly url: string | undefined }
): Result<void, { readonly message: string }> => {
  if (!policy.allowed) {
    return err({ message: "This instance doesn't allow adding MCP servers." });
  }
  if (!policy.transports.some((transport) => transport === server.transport)) {
    return err({
      message: `This instance doesn't allow ${server.transport} MCP servers.`,
    });
  }
  const url = URL.canParse(server.url ?? "") ? new URL(server.url ?? "") : null;
  if (!(url && hostAllowed(url.hostname.toLowerCase(), policy.hosts))) {
    return err({
      message: "This instance doesn't allow MCP servers on that host.",
    });
  }
  return ok(undefined);
};

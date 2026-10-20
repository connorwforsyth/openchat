import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  Connector,
  ConnectorAvailability,
  ConnectorTool,
  McpTool,
  UserServerPolicy,
} from "@workspace/contract/schemas/library";
import { err, ok, type Result } from "@workspace/shared/result";

import {
  type InstanceServerEntry,
  instanceServerId,
  missingSecrets,
} from "./server-config";
import { safeToolName } from "./tool-names";

// Connectors (184): which MCP servers one user has on. Three layers, merged
// here and nowhere else:
//
// 1. the operator's catalog in app.config.yaml (`default: on | off |
//    required`, `allowUserOverride`);
// 2. the servers in the user's MCP Library (owned or shared with them);
// 3. the user's own on/off choices (`mcp_connector_pref`), per server and
//    per tool (188);
// 4. one chat's choices (`mcp_conversation_connector`, 188), over the third
//    until the user resets them.
//
// Locks win over every layer: a required connector or tool stays on.
// Pure: the shell (`connector-service.ts`) loads the three and hands them in.

/** A library server as the merge needs it; no secrets, no URL. */
export interface LibraryMcpServer {
  readonly auth: Connector["auth"];
  readonly description: string;
  readonly id: LibraryItemId;
  readonly name: string;
  /** As stored; a transport this surface doesn't run reads as desktop-only. */
  readonly transport: string;
}

/**
 * One layer's choice for a server (the user's defaults, or a chat's):
 * `enabled` null, and a tool not in `tools`, follow the layer below.
 */
export interface McpChoice {
  readonly enabled: boolean | null;
  /** By the server's tool name; `false` is off. */
  readonly tools: Readonly<Record<string, boolean>>;
}

export type McpChoices = ReadonlyMap<LibraryItemId, McpChoice>;

export interface McpInputs {
  readonly catalog: readonly InstanceServerEntry[];
  /** One chat's choices (188), over `prefs`; left out, the defaults alone. */
  readonly chat?: McpChoices;
  readonly library: readonly LibraryMcpServer[];
  /** The user's stored defaults by server id; absent means "the default". */
  readonly prefs: McpChoices;
  /** The server can't spawn stdio servers; the desktop app can. */
  readonly surface?: "desktop" | "server";
}

const NO_CHOICES: McpChoices = new Map();

/** Whether a tool name is in a list written with either the raw or the safe name. */
const listed = (names: readonly string[], tool: string): boolean =>
  names.some((name) => name === tool || safeToolName(name) === tool);

/** The layers' switch for the connector itself: the chat's, else the user's. */
const chosenEnabled = (
  id: LibraryItemId,
  layers: readonly McpChoices[]
): boolean | undefined => {
  for (const layer of layers) {
    const enabled = layer.get(id)?.enabled;
    if (enabled !== null && enabled !== undefined) {
      return enabled;
    }
  }
};

/** The tools some layer switched off, chat over user, never a required one. */
const offTools = (
  id: LibraryItemId,
  layers: readonly McpChoices[],
  required: readonly string[]
): string[] => {
  const names = new Set(
    layers.flatMap((layer) => Object.keys(layer.get(id)?.tools ?? {}))
  );
  return [...names]
    .filter((tool) => {
      const choice = layers
        .map((layer) => layer.get(id)?.tools[tool])
        .find((value) => value !== undefined);
      return choice === false && !listed(required, tool);
    })
    .sort();
};

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
  layers: readonly McpChoices[],
  surface: "desktop" | "server"
): Connector => {
  const id = instanceServerId(entry.name);
  const reason = entry.reason ?? null;
  const requiredTools = [...entry.tools.required];
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
    customized: false,
    description: entry.description ?? null,
    disabledTools: offTools(id, layers, requiredTools),
    id,
    name: entry.name,
    requiredTools,
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
  return {
    ...base,
    enabled: chosenEnabled(id, layers) ?? byDefault,
    lock: null,
  };
};

const fromLibrary = (
  server: LibraryMcpServer,
  layers: readonly McpChoices[],
  surface: "desktop" | "server"
): Connector => {
  const transport =
    server.transport === "http" || server.transport === "sse"
      ? server.transport
      : "stdio";
  return {
    auth: server.auth,
    availability: availabilityOf(transport, surface, []),
    customized: false,
    description: server.description === "" ? null : server.description,
    disabledTools: offTools(server.id, layers, []),
    enabled: chosenEnabled(server.id, layers) ?? true,
    id: server.id,
    lock: null,
    name: server.name,
    requiredTools: [],
    source: "library",
    title: server.name,
    transport,
  };
};

const merge = (
  { catalog, library, surface = "server" }: McpInputs,
  layers: readonly McpChoices[]
): readonly Connector[] => {
  const instance = catalog.map((entry) => fromCatalog(entry, layers, surface));
  const taken = new Set(instance.map((connector) => connector.id));
  return [
    ...instance,
    ...library
      .filter((server) => !taken.has(server.id))
      .map((server) => fromLibrary(server, layers, surface)),
  ];
};

const sameChoice = (a: Connector, b: Connector | undefined): boolean =>
  b !== undefined &&
  a.enabled === b.enabled &&
  a.disabledTools.join("\n") === b.disabledTools.join("\n");

/**
 * The user's connectors: the catalog in config order, then their library.
 * With `chat`, each says whether that chat's choice differs from the
 * user's defaults (`customized`), for the composer's "differs" mark.
 */
export const effectiveMcpServers = (
  inputs: McpInputs
): readonly Connector[] => {
  const chat = inputs.chat ?? NO_CHOICES;
  const defaults = merge(inputs, [inputs.prefs]);
  if (chat.size === 0) {
    return defaults;
  }
  return merge(inputs, [chat, inputs.prefs]).map((connector, index) => ({
    ...connector,
    customized: !sameChoice(connector, defaults[index]),
  }));
};

/** Whether a chat differs from the user's defaults anywhere. */
export const anyCustomized = (connectors: readonly Connector[]): boolean =>
  connectors.some((connector) => connector.customized);

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

/**
 * For every run (188): the tools left out of each server, by the server's
 * tool name. Only servers with some switched off are listed.
 */
export const excludedTools = (
  connectors: readonly Connector[]
): ReadonlyMap<LibraryItemId, readonly string[]> =>
  new Map(
    connectors
      .filter((connector) => connector.disabledTools.length > 0)
      .map((connector) => [connector.id, connector.disabledTools])
  );

/** Whether one tool is on for this connector: required, else not switched off. */
export const toolEnabled = (connector: Connector, tool: string): boolean =>
  listed(connector.requiredTools, tool) ||
  !listed(connector.disabledTools, tool);

/**
 * A connector's tools as the server listed them (already less what the
 * operator denies), each with its switch and lock.
 */
export const mcpServerTools = (
  connector: Connector,
  tools: readonly McpTool[]
): readonly ConnectorTool[] =>
  tools.map((tool) => ({
    description: tool.description,
    enabled: toolEnabled(connector, tool.name),
    lock: listed(connector.requiredTools, tool.name)
      ? { reason: null, type: "required" as const }
      : null,
    name: tool.name,
  }));

export interface McpLocked {
  readonly type: "locked";
}

/** The connector after the user flips it, or why they can't. */
export const toggleMcpServer = (
  connector: Connector,
  enabled: boolean
): Result<Connector, McpLocked> =>
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

/** One tool after the user flips it, or why they can't: the operator requires it. */
export const toggleMcpServerTool = (
  connector: Connector,
  tool: string,
  enabled: boolean
): Result<Connector, McpLocked> => {
  if (listed(connector.requiredTools, tool)) {
    return err({ type: "locked" });
  }
  const others = connector.disabledTools.filter((name) => name !== tool);
  return ok({
    ...connector,
    disabledTools: enabled ? others : [...others, tool].sort(),
  });
};

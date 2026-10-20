# Connectors: operator defaults + per-user control (ticket 184)

## What existed (2026-10-20)

- `app.config.yaml` `mcp.servers: [{ name, url, transport, headers }]`
  (D18): every user got every entry, always on. No OAuth, no stdio, no
  tool filter, no way to require or switch one off. An unset `${ENV}`
  inside a header ("Bearer ${X}") failed boot.
- `packages/mcp`: a ported LibreChat connection manager (HTTP/SSE, per-user
  OAuth, sealed header secrets, SSRF check, tool allow/deny filter that
  instance servers never used), `ServerRegistry`, `listUsableServers`
  (instance + owned + granted ids, used for plain chats).
- MCP Library (D13): `mcp_server` library items, `mcp_oauth_token` (FK to
  `mcp_server`, so instance servers could never hold OAuth tokens), the MCP
  builder form in `packages/library-ui`.
- Contract `mcp` group: per-server status, tools, start OAuth, disconnect.
- No user-level view: no settings page, no per-user on/off.

## Design

One pure function merges three layers; everything else is shell.

```
effectiveConnectors({ catalog, library, prefs, surface }) -> Connector[]
  catalog  operator entries from app.config.yaml (layer 1)
  library  MCP servers the user owns or was shared (layer 2)
  prefs    the user's stored on/off per server id (layer 3)
```

Rules: `required` -> on, locked (reason shown). `allowUserOverride: false`
-> at `default`, locked. Otherwise the user's choice, else `default`.
Library servers: the user's choice, else on. stdio -> `desktop_only` on the
server surface; an unset secret -> `unconfigured` (names the header only).
`enabledServerIds` feeds plain chats; `disabledServerIds` is subtracted from
agent runs, so an agent can't re-enable something the user or operator
turned off. `checkUserServer(policy, server)` enforces
`mcp.userServers` (allowed, transports, host patterns) on library writes.

The org layer (D17: orgs choose within instance limits) slots in as a
fourth input later; it isn't built.

## Interfaces

- Config: `mcp.servers[]` (`default`, `allowUserOverride`, `reason`,
  `title`, `description`, `tools`, remote `url/headers/auth`, stdio
  `command/args/env`), `mcp.userServers`. Old entries still parse.
- DB: `mcp_connector_pref(user_id, mcp_server_id, enabled)`; FK dropped on
  `mcp_oauth_token.mcp_server_id` (explicit cleanup on library delete).
- Contract (184a, separate PR): `GET /connectors`, `PUT /connectors/{id}/enabled`.
  OAuth connect/disconnect reuse `/mcp/{id}/oauth`.
- UI: Settings > Connectors.

## Open questions

- Org-level policy (an org admin requiring or banning a connector within
  the instance's limits) — needs an `org_settings` field and admin UI.
- Should `default: off` instance servers still be pickable in the Agent
  Builder for agents? Today the agent's list is filtered by the user's
  effective state, so `off` means off until the user flips it.
- stdio on the desktop: the merge already takes `surface: "desktop"`; the
  desktop app still has to spawn them.
- Tool-level toggles per user (beyond the operator's allow/deny).

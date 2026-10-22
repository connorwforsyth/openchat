---
id: "184"
title: "Connectors: operator defaults in app.config.yaml + per-user control"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["184a"]
---

## Question

Connor (2026-10-20): "create an easy configuration for users of openchat
who have forked the code, to manage connectors / MCPs / plugins within the
configuration … a global MCP config that enables the app to set default
MCPs for all users. But users also have the ability to control and
configure their MCPs via their settings or a plugins panel."

Today `mcp.servers` in app.config.yaml is a flat list every user gets, with
no way to turn one off, require one, allow-list tools, use OAuth or stdio,
or limit what users add. Design: `.context/research/mcp-config/README.md`.

## Done when

- **Config** (`packages/config`): `mcp.servers[]` entries take
  `default: on | off | required`, `allowUserOverride`, `reason`, `title`,
  `description`, `tools: { allow, deny }`; remote entries `url`, `headers`
  (`${ENV}` only), `auth: none | oauth`; stdio entries `command`, `args`,
  `env`. `mcp.userServers: { allowed, transports, hosts }`. The old
  one-line entry still parses; an unset secret marks only that server
  unconfigured; an empty file still boots.
- **Merge** (`packages/mcp/src/connectors.ts`): pure
  `effectiveConnectors({ catalog, library, prefs, surface })`, plus
  `enabledServerIds`, `disabledServerIds`, `toggleConnector`,
  `checkUserServer`, with unit tests.
- **State** (`packages/db`): `mcp_connector_pref(user_id, mcp_server_id,
  enabled)`; `mcp_oauth_token.mcp_server_id` stops being a foreign key so
  instance servers can hold per-user OAuth tokens; deleting a library
  server deletes its tokens and choices. PGlite tests.
- **Runs**: plain chats get `enabledServersFor`; agent runs drop
  `disabledServersFor` from the agent's servers. Library create/update of an
  MCP server obeys `userServers`.
- **API**: the `connectors` group (184a) implemented in
  `packages/server/src/api/connectors.ts`, tested in-process.
- **UI**: Settings > Connectors lists the operator's connectors (required
  ones locked with the reason, desktop-only and needs-setup badges), the
  user's own and shared ones, switches, Connect/Disconnect for OAuth, "Add
  your own" when allowed, and empty and error states. Browser-mode tests.
- **Docs**: `app.config.example.yaml` examples and "Configuring connectors
  for your fork" in `docs/self-hosting.md`.

## Owns

`packages/config/src/schema.ts` (the `mcp` block), `packages/config/src/mcp.test.ts`,
`packages/mcp/src/{connectors,connector-service,registry,server-config}.ts`
and their tests, `packages/db/src/schema/library.ts` (MCP tables),
`packages/db/src/queries/mcp.ts`, the `connectors` migration,
`packages/server/src/api/connectors.ts`, the MCP wiring in
`packages/server/src/{server,services,app}.ts` and `runs/turn.ts`,
`packages/server/src/library/{core,definitions}.ts` (the policy check),
`apps/web/app/(app)/(pages)/settings/connectors/`,
`apps/web/app/(app)/(pages)/settings/_components/connectors-settings*`,
the settings nav, `app.config.example.yaml` (`mcp:`), `docs/self-hosting.md`
(connectors section).

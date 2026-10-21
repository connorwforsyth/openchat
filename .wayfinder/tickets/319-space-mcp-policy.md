---
id: "319"
title: "Spaces: owners require or ban MCP servers for their space"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["187"]
---

## Destination

An owner or admin of a root space can mark an MCP server **required** (always
on, can't be switched off) or **banned** (never offered, not even from a
member's own library) for chats in that space and every sub-space below it.
Members see the lock and the owner's reason next to the toggle, the same way
they see an operator lock today.

## What exists

- The operator already locks servers per instance in `app.config.yaml`
  (`mcp.servers[].default: required`, `allowUserOverride: false`, `reason`,
  `tools.allow | deny | required`).
- `effectiveMcpServers` in `packages/mcp/src/effective.ts` merges four
  layers (operator catalog, MCP Library, user prefs, one chat's choices), and
  "locks win over every layer". A space policy is a fifth layer that sits
  under the operator and over everything else.
- MCP Library items can already be owned by a team or org
  (`mcpServerScopeSchema`), so a space can name its own servers.

## Shape (proposed)

- `space_mcp_policy(spaceType, spaceId, serverId, rule: required | banned,
  reason, tools: { deny, required })`, keyed by `serverId`, which is a
  catalog id or a library item id.
- Pure merge: the chat's space and every space above it contribute their
  rules. Operator rules win, then the nearest space's rule wins, with banned
  over required on a tie. `effectiveMcpServers` takes the resolved rules as
  one more input, so the shell loads them and the core stays pure.
- A run applies the same rules (`disabledServerIds`, `excludedTools`), so an
  agent that lists a banned server still doesn't get it.

## Work

1. Contract PR: a `spaces.mcpPolicy` get and set pair, plus `locked` and
   `lockedBy: "instance" | SpaceRef` on `Connector`.
2. Migration and queries in `packages/db`.
3. The merge layer in `packages/mcp` with table-driven tests.
4. Space settings: a "Connectors" section in the full-screen settings view
   (no second sidebar) listing servers with Required, Banned and Default.
5. e2e: an owner bans a server, and a member's composer no longer offers it.

## Open for Connor

- Can a sub-space owner loosen a rule set above them? Default: no. Rules only
  tighten going down the tree.
- Does "banned" also hide a member's personal library server inside space
  chats? Default: yes. Their own chats are untouched.

Parked from the overnight spaces lane (2026-10-21). It needs a contract
change, a migration and a settings section, which is more than the lane
could carry on a shared, loaded machine.

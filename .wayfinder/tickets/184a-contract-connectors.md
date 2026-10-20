---
id: "184a"
title: "Contract: the `connectors` group (list, turn on or off)"
labels: [wayfinder:build]
status: open
assignee: owner
blockedBy: []
---

## Question

184 needs a user-level view of MCP servers that merges the operator's
catalog with the user's library and their on/off choices. The `mcp` group
only answers per server (status, tools, OAuth).

## Done when

- `GET /connectors` returns `ConnectorList`: each connector's `enabled`,
  `lock` (`required` | `operator`, with a reason), `availability`
  (`available` | `desktop_only` | `unconfigured`), `source`, `transport`,
  `auth`; plus the instance's `userServers` policy.
- `PUT /connectors/{id}/enabled` `{ enabled }` returns the `Connector`;
  FORBIDDEN when locked, NOT_FOUND when the caller can't use it.
- Round-trip cases for the new schemas; `openapi.json` regenerated.
- Additive only; merged by the owner (draft PR #144).

## Owns

`packages/contract/src/routes/connectors.ts`, the connector schemas in
`packages/contract/src/schemas/library.ts`, `contract.ts`, `openapi.ts`,
`openapi.json`, the README group list.

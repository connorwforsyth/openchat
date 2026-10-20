---
id: "187a"
title: "Contract: the `spaces` procedure group"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

187 needs a surface that speaks in spaces rather than orgs and teams.

## Done when

An additive `spaces` group in `packages/contract` (no existing route changes):
`list`, `get`, `content`, `share`, `unshare`, `members`, `setMember`,
`removeMember`, `createChild`, `allowance`, `setAllowance`, `requestAllowance`,
`decideAllowance`, `keyUsage`. Its own draft PR; Connor merges.

## Owns

`packages/contract/src/schemas/spaces.ts`, `packages/contract/src/routes/spaces.ts`, `packages/contract/src/contract.ts` (one line).

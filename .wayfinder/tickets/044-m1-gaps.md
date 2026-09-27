---
id: "044"
title: "M1 gaps before the demo"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Found by 040's end-to-end suite (steps it had to do through the API):
1. **Create an org** from the UI (account menu → "New organisation"), switch between orgs, and
   create/nest teams from the admin team tree if that isn't already there.
2. **Invite link UI**: admin Members shows the one-time invite link with a copy button (042's token).
3. **Choose an agent in a chat**: the composer's agent picker lists usable agents (mine, shared,
   team/org libraries) and starts/continues the chat with it; "Use in chat" from the library.
4. **PDF attachments on models that can't read PDFs**: attach as a file part only when the model
   supports it; otherwise ingest it and let `file_search` answer (the turn must not fail).
5. **Live titles**: the sidebar and header pick up the generated title without a reload (events or
   query invalidation after the title job).
6. **Rate limiting behind a proxy**: trust `X-Forwarded-For` only from configured proxies
   (`TRUSTED_PROXIES` / config) so users don't share one sign-in bucket.

## Owns

`apps/web`, `packages/chat-ui`, `packages/composer`, `packages/server`, `packages/auth`, e2e tests.

## Done when

Each item works in the browser and has an e2e test (turn 040's API shortcuts into UI steps); the
e2e fixme passes; local gate green.

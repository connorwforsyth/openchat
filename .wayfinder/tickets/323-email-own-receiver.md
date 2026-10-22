---
id: "323"
title: "Email phase 4: own domain and inbound receiver (stub)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["322"]
---

## Question

Stub: specify when 322 closes and an operator needs it. An optional
`apps/mail-inbound` (smtp-server, mailparser, mailauth) behind MX, isolated
like `sandbox-runner`: it accepts, verifies, stores and enqueues, and never
calls a model. Outbound still goes through a relay. Research:
[`.context/research/email`](../../.context/research/email/README.md),
"Phase 4".

## Done when (outline)

- A `mail-inbound` compose profile; unknown recipients refused at `RCPT`,
  oversized mail refused, per-IP rate limits.
- VERP bounces and DSN parsing into `email_suppression`.
- An admin "Email health" page checking SPF, DKIM, DMARC and MX.
- Docs for running Stalwart, docker-mailserver or Mailu alongside.

## Owns

To be set when specified.

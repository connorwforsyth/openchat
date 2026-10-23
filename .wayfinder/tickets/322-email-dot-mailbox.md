---
id: "322"
title: "Email phase 3: a Dot mailbox (receive, then send with approval) (stub)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["320"]
---

## Question

Stub: specify fully when 320 closes, and grill Connor first (who may email
a Dot, and what a Dot may send). A Dot gets an address; mail from allowed
senders becomes a Dot run. Inbound email is the most hostile input the app
takes. Research: [`.context/research/email`](../../.context/research/email/README.md),
"Inbound options", "Security" and "Phase 3".

## Done when (outline)

- Sources against a mailbox the operator already has: IMAP (imapflow IDLE)
  or Microsoft Graph delta polling. An opaque, rotatable address token per
  Dot.
- `inbound_email` deduped by `(mailbox, Message-ID)`; DMARC pass and a sender allowlist
  (the owner by default); unknown senders quarantined, never shown to the
  model; RFC 3834 loop rules.
- Email-triggered runs are unattended, read-only and budgeted (175).
- A `send_email` tool that always pauses for approval, with a daily cap,
  sending through the phase 1 outbox.
- Contract PR (`dots.mailbox.*`, `dots.senders.*`, `dots.inbound.*`, a
  `data-email` part) and a `MailboxSource` port PR.
- Evalite prompt-injection fixtures that must produce no tool call.

## Owns

To be set when specified.

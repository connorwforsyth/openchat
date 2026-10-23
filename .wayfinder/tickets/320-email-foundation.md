---
id: "320"
title: "Email phase 1: transactional email (Mailer port, outbox, invite emails)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

The app sends no email. Invitations return a link the admin passes on by
hand, there is no password reset, and nothing verifies an address. Phase 1
adds outbound transactional email that any self-hoster can point at their
own relay, without a paid service or vendor SDK. Research, versions and
sources: [`.context/research/email`](../../.context/research/email/README.md)
(phase plan at "Proposed phased plan").

## Done when

- **Config:** an `email:` block in `packages/config` (zod, `.prefault({})`):
  `transport` (`none` default | `smtp` | `graph`), `from`, `replyTo`,
  `smtp` (host, port, secure, auth, pool), `graph` (tenantId, clientId,
  clientSecret from `${ENV}`, sender), `dkim`, `linkBaseUrl`. Unset secrets
  leave the block absent. With an empty `.env` the app boots exactly as
  before. `brand.emailLogo` (a PNG URL; SVG is unsafe in email).
- **Public config:** `features.email` is true only when a transport is
  configured. The UI shows email options only then.
- **Port:** `Mailer` in `packages/server/src/ports/mailer.ts`:
  `send(message) → AsyncResult<{ messageId }, MailerError>`, with
  `MailerError` a union of `transient | permanent | misconfigured`, and an
  in-memory fake next to it. Its own PR (see Split).
- **Adapters** (functions, no classes): nodemailer SMTP (pooled, one
  transport per process, `err.permanent` mapped to the union), and Microsoft
  Graph `sendMail` with a MIME body composed by nodemailer and an app-only
  token. No vendor SDKs.
- **Templates:** a new `packages/email` with React Email 6 (`react-email`,
  MIT): `InviteEmail` first, then `ResetPasswordEmail` and `VerifyEmail`.
  `renderEmail(templateId, props, { i18n, brand, theme })` returns
  `{ subject, html, text }`. Strings through Lingui, brand from config,
  colours from a theme generated from `globals.css` (one exempt path in the
  `tokens` guard).
- **Delivery:** an `email_outbox` table (status union `queued | sending |
  retry | sent | failed | suppressed | cancelled`, unique
  `idempotency_key`, template id and props, never rendered HTML) and
  `email_suppression`. The domain write and the outbox insert share one
  transaction. An `email.send` pg-boss job per row claims it, renders,
  sends and records the message id; transient errors persist `retry`,
  `last_error` and the incremented attempt count before retrying with backoff,
  permanent ones fail without retry. An `email.sweep` cron re-enqueues
  orphaned rows. External delivery is at-least-once; a crash after relay
  acceptance but before recording `sent_at` may cause another send. The
  outbox key deduplicates rows, and singleton jobs prevent concurrent sends.
  Link-bearing props are encrypted (D24) and nulled once
  sent.
- **Invites:** `orgs.invite` takes `sendEmail?: boolean` and answers
  `emailed: boolean`, meaning the outbox accepted the message. It does not
  report provider delivery. The copy-link path stays in every case. Better Auth
  reset and verify hooks are set only when email is configured, and never
  awaited (timing).
- **Dev inbox:** a Mailpit service in `docker-compose.yml` under a `mail`
  profile (SMTP 1025, UI 8025), documented in `docs/self-hosting.md` and
  `.env.example`.
- **Tests:** template text snapshots; outbox idempotency; transient retry
  vs permanent fail; the sweeper; suppression; raw headers via nodemailer
  `streamTransport`; the Graph adapter under MSW (202, 429, 400); config
  parsing (absent, present, interpolated-empty, invalid). Playwright with
  the Mailpit profile: an emailed invite arrives and its link joins.
- No secret in logs, fixtures, PR text or outbox rows after `sent`.

## Split

Per AGENTS.md, frozen interfaces go first in their own PRs:

- **320a contract:** `orgs.invite` `sendEmail` / `emailed`, and
  `features.email` in the public config shape.
- **320b port:** `packages/server/src/ports/mailer.ts` and its fake.
- **320c guards:** the `tokens` exemption for the generated email theme and
  `lingui` extract coverage for `packages/email`.

Spike first: `react-dom/server` rendering inside the Next 16 route-handler
graph (fallback: render only in the job handler module, or
`serverExternalPackages`).

## Owns

`packages/email/`, `packages/server/src/email/`, the `email` jobs in
`packages/server/src/jobs/`, `packages/db/src/schema/email.ts` and its
migration and queries, the `email` and `brand.emailLogo` parts of
`packages/config/src/{schema,public}.ts`, the invite-email wiring in
`packages/auth/src/{server.ts,handlers/orgs.ts}`, the invite dialog's email
option in `apps/web`, the `mailpit` service in `docker-compose.yml`, the
email section of `docs/self-hosting.md`, `app.config.example.yaml` and
`.env.example`.

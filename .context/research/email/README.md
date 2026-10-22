# Email: outbound, notifications and a Dot mailbox

Research for openchat, branch of record `origin/pstack/overnight`, 2026-10-22. No code was changed.
Versions are from the npm registry and GitHub releases on 2026-10-22 unless a source says otherwise.

## Recommendation

1. **Outbound: one `Mailer` port with nodemailer behind it, and SMTP as the default transport.** Every operator can point SMTP at something: Mailpit in dev; Postmark, SES, Mailgun or a Google Workspace relay in production; Microsoft 365 over SMTP with OAuth2. Add a second adapter for **Microsoft Graph `sendMail` (app-only, MIME body)**, because the app already does Entra SSO (ticket 186) and SMTP AUTH Basic in Exchange Online is switched off by default from the end of December 2026. Install no vendor SDKs. A vendor is just an SMTP host in `app.config.yaml`, so the "OSS deps only, no paid services" rule holds.
2. **Templates: React Email 6 (`react-email`, MIT), rendered with `render()` and `toPlainText()`, no Resend.** Keep them in a new `packages/email`, with Lingui for strings and the brand read from config. Two repo rules collide with email and need decisions first. Email clients need literal colours, which the `tokens` guard bans, so generate an email theme from `globals.css`. Email clients also don't show SVG reliably, so the brand needs a PNG logo.
3. **Delivery: a transactional outbox (an `email_outbox` table) plus one pg-boss `email.send` job per row.** The pg-boss `exclusive` policy the repo uses only dedupes jobs that are queued or active. It is not lifetime idempotency, so the outbox row's unique `idempotency_key` is the real guard. This runs in `web` now and moves to `apps/worker` with no code changes (D4).
4. **No separate outbound mail service.** The case for a separate process is **inbound** SMTP. A small optional `apps/mail-inbound` (smtp-server, mailparser and mailauth) would sit behind MX and only accept, verify, store and enqueue. It would never call a model. This follows the `sandbox-runner` isolation pattern.
5. **Dot mailbox: start with IMAP (imapflow IDLE) or Microsoft Graph polling/delta against a mailbox the operator already has. Run your own MX receiver last.** Treat every inbound email as untrusted, prompt-injection-bearing input. Require DMARC to pass and the sender to be on an allowlist (by default the owner's verified addresses). Unattended Dot runs on email get read-only tools. Obey RFC 3834 so the Dot never auto-replies to automated mail.
6. **Never send direct-to-MX from the app host.** Major clouds block port 25 outbound by default, and IP reputation is the hard part. Sending always goes through a relay, including "as the Dot". Own-domain work means SPF, DKIM and DMARC on the operator's domain, with DKIM signed by the relay or by nodemailer.

## What exists today (origin/pstack/overnight)

- **No email anywhere.** There is no `nodemailer`, React Email or SMTP code or config. `git grep` finds no `sendResetPassword`, `sendVerificationEmail` or `sendInvitationEmail`.
- **Invitations produce a link only.** `packages/auth/src/server.ts` (org plugin config) explains it: "There is no mail transport in M1 … a random token is the capability (Q16, 042): `orgs.invite` returns it once and stores only its hash (`invitation_token`); the admin passes the link on." `requireEmailVerificationOnInvitation: false`. The recipient check (the session email must match the invitation) still applies. The token comes from `packages/auth/src/invitation-token.ts` (32 random bytes, stored as a sha256 hash), and the handler is `packages/auth/src/handlers/orgs.ts:328-386` (`invite` returns `{ …invitation, token }`). The page is `apps/web/app/(auth)/invite/[token]/page.tsx`.
- **Better Auth 1.7.6** (catalog; npm latest is 1.7.12). It is configured with `emailAndPassword: { enabled: true }` and no `sendResetPassword`, so there is no password reset. `emailVerification` isn't configured, so new accounts get `emailVerified` false and nothing verifies them. All organization HTTP routes are disabled (`disabledPaths`) and driven through oRPC instead.
- **pg-boss 12** (`^12.35.0`; latest is 12.38.0). The port is `packages/server/src/ports/job-queue.ts`, with an in-memory fake next to it. The adapter is `packages/server/src/jobs/pg-boss-queue.ts`. Every queue is created with `policy: "exclusive"`, and a job without a `singletonKey` gets its own id as the key. The registry is `packages/server/src/jobs/registry.ts` (zod schema, defaults and handler per name; jobs include `dot.run`, `dot.tick`, `title.generate` and others). `start.ts` returns `null` if pg-boss can't start, so the app boots without jobs.
- **Dots notify policy exists** (ticket 175): `dot_schedule.notify` is one of `all | failures | important | none`, plus `dot_run.notified` and a pure `shouldNotify(outcome, policy)`. That is the in-app half of notifications. There is no `notification` table yet; PLAN §7 lists `notification` and `push_subscription` for the Collaboration wave, and the Collaboration wave row in PLAN §5 says "notifications (web push, Expo push, email)".
- **Config:** `packages/config/src/schema.ts` uses zod `strictObject`s with `.prefault({})`. `${ENV}` interpolation (`parse.ts` `interpolateEnv`) treats an unset variable as "key absent", so a block whose secrets are unset falls back to defaults rather than failing. The microsoft block uses the same convention ("with them unset the block interpolates to a provider left off, never a boot failure"). `brand:` holds `name`, `appId`, `favicon`, `logo` and `urlScheme`; the example's logo is `./brand/logo.svg`. The app URL comes from `BETTER_AUTH_URL` (`packages/auth/src/env.ts`).
- **Compose:** services are web, postgres and optional profiles (`search`, `sandbox`, `artifacts`, `voice`). There is no mail service.
- **Stack:** Next 16.3.6, React 19.2.8, zod 4, Hono 4, `@lingui/core` ^6.8. `packages/i18n/src/catalog.ts` already builds `setupI18n` instances outside React, which email rendering can reuse.

Relevant PLAN decisions: **D4** (pg-boss in `web` now, `apps/worker` later, with handlers registered in one place), **D6** (Docker-first, one compose path, optional services as profiles), **D8** (zod-first, ports as arguments, Result values, no classes outside adapters), **D18** (YAML for instance settings, `${ENV}` for secrets, brand only in `brand:`), **D24** (AES-GCM secrets at rest, rate limits and budgets).

---

## 1. Outbound transports via nodemailer

**nodemailer 10.2.0** (2026-10-21; license MIT-0 on npm). 10.0.0 (2026-09-03) needs **Node ≥ 20**, is written in TypeScript and ships both ESM and CJS builds. 9.0.0 (2026-06-14) turned on TLS certificate checking by default for remote content and OAuth token fetches. 10.2.0 added `err.permanent`, which marks an SMTP error as permanent or transient (exactly what retry logic needs), plus `info.serverMessageId` and `pendingCount()` on the pool. Source: [CHANGELOG](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md).

| Option | How | Pros | Cons |
|---|---|---|---|
| **Generic SMTP** (Postmark, SES SMTP, Mailgun, Brevo, Workspace relay, Mailpit) | `createTransport({ host, port, secure, auth })` | One code path for every provider, no SDKs, works with every OSS relay | Deliverability is the provider's job; bounces come by webhook or a bounce mailbox |
| **Google Workspace SMTP relay** | `smtp-relay.gmail.com:587`, with TLS and SMTP AUTH or an IP allowlist | Cheap if the org already has Workspace | 10,000 messages and 10,000 unique recipients per user per 24 h; 100 recipients per transaction ([Google](https://knowledge.workspace.google.com/admin/gmail/advanced/route-outgoing-smtp-relay-messages-through-google)) |
| **Microsoft 365 SMTP AUTH (Basic)** | `smtp.office365.com:587` with a user and password | Works today | **Basic is disabled by default for existing tenants at the end of December 2026** and unavailable by default for new tenants after that; the final removal date will be announced in H2 2027 (MC786329, updated 2026-01-27: [mirror](https://mc.merill.net/message/MC786329)). It's also off under Entra security defaults ([Learn](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)) |
| **Microsoft 365 SMTP AUTH with OAuth2** | nodemailer `auth: { type: "OAuth2", user, accessToken }` (XOAUTH2); token by client credentials with scope `https://outlook.office365.com/.default`; app permission `SMTP.SendAsApp`; `New-ServicePrincipal` plus `Add-MailboxPermission` per mailbox ([Learn](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)) | Survives the Basic retirement and keeps the SMTP code path | The tenant must still allow SMTP AUTH per mailbox; Exchange PowerShell setup is fiddly |
| **Microsoft Graph `sendMail`** | `POST /users/{id}/sendMail`, either as JSON or with a **base64 MIME body** (`Content-Type: text/plain`); returns `202 Accepted` ([Learn](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)) | No SMTP AUTH dependency; HTTPS only; fits the existing Entra app; saves to Sent Items (useful for "the Dot sent this") | Exchange limits apply: **30 messages/min, 10,000 recipients/day** per mailbox, plus a tenant external recipient limit (TERRL); `onmicrosoft.com` domains are limited to 100 external recipients/day ([limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits)). "Exchange Online isn't suited to accommodate bulk-mailing" |
| **SES via the AWS SDK transport** | nodemailer `SES: { sesClient, SendEmailCommand }` | Native SES features | Adds `@aws-sdk/client-sesv2`, and SES's own SMTP endpoint does the same job. Skip it |

**Graph permissions.** `Mail.Send` (application) can send **as any user** unless it is scoped. **Application Access Policies are superseded by RBAC for Applications**: "it replaces Application Access Policies". Scope with `New-ManagementScope` (or an Admin Unit) plus `New-ManagementRoleAssignment -Role "Application Mail.Send" -CustomResourceScope …`. You must then **remove the unscoped Entra consent**, because grants from the two systems are a union. Permission changes are cached for 30 min to 2 h ([Learn: RBAC for Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)). Delegated `Mail.Send` (the user's own mailbox) is the other option, for "send as me". It needs a stored refresh token, which would be encrypted per D24.

**Graph adapter shape.** Use nodemailer only to *compose* the message (MailComposer, or `streamTransport: true, buffer: true`), which gives one DKIM, header and List-Unsubscribe path. Then POST the base64 raw message to Graph with `fetch` and an MSAL (`@azure/msal-node` 7.1.1, MIT) or hand-rolled client-credentials token. Nodemailer's custom transport API (an object with `send(mail, cb)`) would let this plug in as `createTransport(graphTransport)`. A plain function adapter behind our own `Mailer` port is simpler and fits D8's "no classes outside adapters" just as well.

**DKIM in nodemailer.** Configure it per transport or per message: `dkim: { domainName, keySelector, privateKey }`, or `keys: [...]` for rotation. It supports `headerFieldNames`/`skipFields` and `cacheDir`; Nodemailer 10 raised the in-memory threshold to 10 MB ([docs](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/dkim/index.md)). With a relay that signs for you (Postmark, SES or M365 do), you don't need it. You need it when the operator relays through a dumb smarthost but wants alignment on their own domain. Google requires DKIM keys of at least 1024 bits and recommends 2048 ([Google](https://support.google.com/a/answer/81126)). Store the key as an `${ENV}` secret, never in YAML.

**Pooling and rate limits.** `pool: true` with `maxConnections` (5), `maxMessages` (100), `rateDelta` (1000 ms) and `rateLimit` (0 means off; it's global across the pool) ([docs](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/smtp/pooled.md)). Use one long-lived transport per process. Graph should use its own token bucket (30/min per mailbox). pg-boss worker `concurrency` is the outer limit.

## 2. React Email

- **Current:** `react-email` **6.11.3** (16 Oct 2026), `@react-email/render` 2.1.1, `@react-email/ui` 6.11.3 (dev preview), all **MIT**. **6.0** (Resend blog, created 2026-04-17) unified everything into one package: components *and* `render` import from `react-email`. `@react-email/components` (1.0.12) and `@react-email/preview-server` are the legacy packages ([React Email 6](https://resend.com/blog/react-email-6), [manual setup](https://react.email/docs/getting-started/manual-setup), [releases](https://github.com/resend/react-email/releases)). **5.0** (Nov 2025) added Tailwind 4 support and a dark-mode switcher in the *preview* ([React Email 5](https://resend.com/blog/react-email-5)).
- **No Resend dependency.** `render(<Template/>)` returns HTML (await it); `toPlainText(html)` produces the text alternative, and `data-skip-in-text="true"` drops elements from the text. `pretty` is optional, and since 6.11.3 prettier only loads when `pretty: true`, which fixed a Turbopack-on-Bun failure ([render docs](https://react.email/docs/utilities/render)). Pass `{ html, text }` to nodemailer. Resend appears only as an optional integration in the preview tool.
- **React 19 / Next 16:** peer deps are `react` `^18 || ^19` and `react-dom` the same. 6.11.3 bumped its preview server to Next 16.4.1. **Risk to spike:** rendering runs inside the Hono app mounted in a Next route handler, so `react-dom/server` is imported from the route-handler graph. Prove it in a spike. If Next objects, add `serverExternalPackages: ["react-email"]` or move rendering into the job handler module only, which is where it belongs anyway.
- **Dark mode in clients:** `@media (prefers-color-scheme)` works in about 42% of clients per caniemail (last tested March 2023). Yahoo strips it, and Outlook.com rewrites colours with `data-og*` attributes ([caniemail](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/)). Design one light theme that survives forced inversion: transparent PNG logos with padding, no text baked into images, mid-tone accents. Add `<meta name="color-scheme" content="light dark">` and a prefers-color-scheme block only as progressive enhancement.
- **i18n with Lingui:** templates use `<Trans>`/`` t`…` `` like the rest of the app. The send job builds an `I18n` with `packages/i18n`'s `setupI18n` for the recipient's locale and renders `<I18nProvider i18n={i18n}>…</I18nProvider>`. Subjects come from `i18n._(msg\`…\`)` so they get extracted too. Add `packages/email` to the `lingui extract` sources so the `lingui` guard covers it. **Risk:** Lingui macros need the SWC or Babel plugin. `web` has `@lingui/swc-plugin`, but a future `apps/worker` running plain Node or tsx won't compile macros. Either give the worker the same transform (`@lingui/vite-plugin` or babel), or write templates with `msg` descriptors and `i18n._` (no JSX macro).
- **Repo-rule collisions to settle before writing templates:**
  - **Colours:** inline CSS needs literal colours. Many clients don't support CSS variables, and `oklch()` support is poor. The `tokens` guard bans literals outside `globals.css`. Proposal: a build script turns `globals.css` tokens into `packages/email/src/theme.generated.ts` (hex), and that one path is exempt in `scripts/ci/tokens`, the same way `globals.css` is. Only `@workspace/ui` owns the theme.
  - **Icons:** `@workspace/icons` renders SVG, which Gmail doesn't show. Email uses no icons, or PNGs from `brand:`.
  - **Brand:** add `brand.emailLogo` (an absolute HTTPS PNG URL or a path served by web), because `brand.logo` is an SVG. The name comes from `config.brand.name` at render time (D18).
  - **Logical properties:** use `dir`/`text-align: start`. Many clients don't know `margin-inline-*`, so templates take `dir` from the locale and set physical sides from it.

## 3. Dev inbox and tests

- **Mailpit** (v1.31.6, 2026-10-15; **MIT**; image `axllent/mailpit`, also on ghcr.io): SMTP on 1025, UI and API on 8025 ([Docker docs](https://mailpit.axllent.org/docs/install/docker/)). Its REST API (Swagger, [api-v1](https://mailpit.axllent.org/docs/api-v1/)) has `GET /api/v1/messages`, `GET /api/v1/search?query=to:x subject:y`, `DELETE /api/v1/messages`, `GET /api/v1/message/{ID}`, `/headers`, `/raw`, `/view/{ID}.html`, `/view/{ID}.txt`, plus `html-check`, `link-check`, `sa-check` and `chaos` (fault injection, useful for retry tests) ([swagger](https://raw.githubusercontent.com/axllent/mailpit/develop/server/ui/api/v1/swagger.json)). The alternatives are worse fits: MailHog is unmaintained, and smtp4dev is .NET.

  ```yaml
  # docker-compose.yml: optional, like searxng
  mailpit:
    image: axllent/mailpit:v1.31.6
    profiles: [mail]
    ports: ["8025:8025", "1025:1025"]
    environment:
      MP_MAX_MESSAGES: 5000
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
  ```
- **Vitest (unit and integration):** test the pure core (outbox decisions, `buildMessage`, header building) directly. Fake the `Mailer` port with an in-memory fake next to the port, as the repo already does for job-queue and avatar-store. Run the nodemailer adapter with `jsonTransport: true` (gives a JSON `info.message`) or `streamTransport: true, buffer: true` (raw RFC 5322 to assert headers like `List-Unsubscribe`, `Auto-Submitted` and DKIM). Neither touches the network, as D9 requires ([stream/json transport](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/transports/stream.md)). Mock Graph with **MSW**. Test outbox and pg-boss with **PGlite**, as `pg-boss-queue.test.ts` already does. Render templates with `render()` and snapshot the text part, not HTML.
- **Playwright (E2E):** start the Mailpit profile and point `email.transport` at `mailpit:1025`. Tests poll `GET /api/v1/search?query=to:"<addr>"`, read `/view/{ID}.txt`, extract the link, and drive the reset, verify and invite flows. Call `DELETE /api/v1/messages` in `beforeEach`. Give each test its own recipient address so tests can run in parallel.

## 4. Delivery architecture

**Why an outbox and not "enqueue a job per email" alone.** The repo's pg-boss queues use the `exclusive` policy: "Only allows 1 job to be queued or active." A `singletonKey` therefore dedupes only while a job is in flight. After it completes, the same key can be sent again ([pg-boss queues](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md)). Enqueueing also happens outside the domain transaction. If pg-boss is down (`startJobs` returns `null`), a job enqueued directly is simply lost.

**Pattern:**

1. The domain write and `INSERT INTO email_outbox (…, idempotency_key UNIQUE) ON CONFLICT DO NOTHING` share **one transaction**. Example keys: `invite:<invitationId>:<n>`, `reset:<verificationId>`, `notif:<notificationId>:email`, `digest:<userId>:<yyyy-mm-dd>`.
2. After commit, run `enqueueJob(queue, "email.send", { outboxId }, { singletonKey: outboxId })`. If that fails, the row is still `queued`.
3. A cron `email.sweep` (every minute, `retryLimit: 0`, like `dot.tick`) re-enqueues `queued` rows older than about 2 min and moves rows stuck in `sending` back to `queued`.
4. The `email.send` handler claims the row (`UPDATE … SET status='sending' WHERE id=$1 AND status IN ('queued','retry') RETURNING`), checks the suppression list, renders, sends, and records `provider_message_id` (nodemailer `info.messageId` or `serverMessageId`) and `sent_at`.
   - On a transient error (`err.permanent === false`, 4xx, Graph 429/5xx), return `err` so pg-boss retries. Use `retryBackoff: true, retryDelaySeconds: 30, retryLimit: 5`.
   - On a permanent error (5xx), mark the row `failed` and return `ok`, so it isn't retried.
5. **Rate limiting:** worker `concurrency` (say 2), the nodemailer pool `rateLimit`, and per-recipient throttles on the notification side, not the transport. pg-boss `sendThrottled`/`sendDebounced` (`singletonSeconds`) suit "at most one digest per user per window" ([pg-boss jobs](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md)). The repo's `JobQueue` port doesn't expose `singletonSeconds` yet, which would be a port change.

**Status is a discriminated union** (D8): `queued | sending | retry | sent | failed | suppressed | cancelled`, plus `last_error` and `attempts`. Store **template id and props**, not rendered HTML. Rendering happens at send time, so a retry after a deploy uses the current template, and the outbox holds no copy of secrets.

**Reset and verify links are secrets.** Better Auth's `url` contains the token. Storing it in `email_outbox.props` puts a live credential in a table. Options:

- (a) Encrypt `props` with the D24 AES-GCM helper.
- (b) Store only `verificationId` and rebuild the URL at send time from Better Auth's token row.
- (c) Null the props once the row is `sent`.

Recommend (a) plus (c). Never log props.

**Better Auth hooks:** `emailAndPassword.sendResetPassword({ user, url, token }, request)`, `emailVerification.sendVerificationEmail({ user, url, token }, request)`, and `organization({ sendInvitationEmail(data) })`. Better Auth's docs say: "**Avoid awaiting the email sending to prevent timing attacks**" ([email concepts](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/email.mdx), [email-password](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx), [organization](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/organization.mdx)). With the outbox, the hook only does a fast local insert and enqueue (`void`). Set the hooks **only when email is configured**, and expose `features.email` in public config so the UI shows "Forgot password?" only then. Invitations keep the copy-link path as a fallback in every case. Our `orgs.invite` builds the token link itself, so it inserts the outbox row directly and doesn't use the plugin's `sendInvitationEmail` (whose `data.id` is the deprecated invitation-id capability).

**Where it runs:** today in `web`, through `registerJobs`. Later in `apps/worker` (D4), with no code changes, because the handler and transport are built from config at worker boot.

**A separate mail service?** Not for outbound. It would duplicate pg-boss, config and secrets for no isolation gain, since outbound is just an authenticated client connection. **Inbound is different.** A port-25 listener faces the internet, parses hostile MIME, and must answer quickly to SMTP clients. That justifies `apps/mail-inbound` (optional compose profile `mail-inbound`), which owns:

- the SMTP session (smtp-server),
- size and recipient checks,
- authentication verdicts (mailauth),
- writing the raw `.eml` to `Storage`,
- inserting an `inbound_email` row and enqueueing `email.inbound`.

It never runs a model or holds provider keys, much like `sandbox-runner` is the only thing that touches Docker (D7).

## 5. Inbound options for a Dot address

| Option | Fits | Pros | Cons |
|---|---|---|---|
| **IMAP polling or IDLE** (`imapflow` 2.8.0, MIT) | Any mailbox: Workspace, Fastmail, Stalwart, M365 with OAuth | No public endpoint, no MX change; `auth.accessToken` for XOAUTH2; auto IDLE (`autoIdleDelay` 15 s, `maxIdleTime`, `exists` event); `download()` streams the raw message ([API](https://imapflow.com/docs/api/imapflow-client)) | A long-lived connection per mailbox belongs in the worker, not `web`. "Do not run any other IMAP commands inside the fetch loop" (deadlock). M365 needs `IMAP.AccessAsApp` plus `Add-MailboxPermission` |
| **Microsoft Graph change notifications** | M365 shared mailbox per Dot or one catch-all | Push; `Mail.Read` scoped by RBAC for Applications to the Dot mailboxes only | Needs a **public HTTPS** notification URL (hard for self-hosting); subscriptions for messages last **at most 10,080 min (under 7 days), or 1,440 min with resource data**, so renew them with a cron job; max 1,000 subscriptions per mailbox; latency under 1 min, worst case 3 ([overview](https://learn.microsoft.com/en-us/graph/change-notifications-overview), [Outlook](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)) |
| **Microsoft Graph delta query** | Same, with no inbound HTTP | Pull only; resumable `deltaLink` per folder ([delta for messages](https://learn.microsoft.com/en-us/graph/delta-query-messages)) | Polling latency; throttling; one delta token per mailbox folder |
| **Own receiver behind MX** (`smtp-server` 3.21.0, MIT-0, plus `mailparser` 3.12.0, plus `mailauth` 8.0.1, MIT) | An own subdomain such as `dots.example.com` | Full control; one catch-all for every Dot (`<handle>@dots.example.com`); no per-Dot mailbox licences | Needs inbound port 25 reachable, TLS certificates, spam filtering, and an MX for the subdomain. Example: `authOptional: true`, `size` limit, `onData` → `simpleParser` ([receiving email](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/guides/receiving-email.md)) |
| **Haraka** (3.3.5, MIT) | High-volume inbound with a plugin ecosystem | Mature MTA, plugins for SPF, DKIM and DNSBL | A whole MTA to operate. Use it only if smtp-server outgrows the job |

**Inbound authentication.** `mailauth.authenticate(raw, { ip, helo, sender, mta })` returns verdicts for `spf`, `dkim`, `dmarc`, `arc` and `bimi`, and can ARC-seal ([mailauth](https://github.com/postalsys/mailauth)). For IMAP or Graph sources, don't re-verify (forwarding breaks SPF). Parse the provider's `Authentication-Results` header, trusting **only** the authserv-id of your own provider.

**Addressing.** Use one catch-all domain or a plus address (`dot+<opaque>@…`). Map the address to a Dot by an **opaque, rotatable token** stored hashed, like `invitation_token`, not by user id. Rotating the address invalidates leaked ones.

**Security (Dot email is the most hostile input the app will ever take):**

- **Prompt injection:** email bodies, subjects, display names and attachments are data, never instructions.
  - Wrap them as `<email from=… verified=…>` parts.
  - Run Dot turns triggered by email under the unattended-run guardrails from ticket 175: `runStepBudget`, `runTokenBudget` and `report_outcome`.
  - Give them the **read-only tool filter** by default. Never let them call `send_email`, MCP write tools or sandbox network egress without an approval (`awaiting_approval`, D4).
  - Show the owner a "from email" badge.
- **Sender allowlist:** the default is the owner's verified addresses only. Accept mail only on **DMARC pass with alignment** (or DKIM pass on an allowlisted domain). Unknown senders go to a quarantine list the owner can approve from; they never reach the model.
- **Attachments:**
  - Cap size and count, and allow types by sniffed MIME, not filename.
  - Store them through the existing `Storage` and file ingestion (`INGEST_FILE_JOB`).
  - Never execute or unpack archives automatically.
  - Strip remote images and tracking pixels when converting HTML to text, so mail is never fetched with the server's IP.
- **Loops and auto-replies (RFC 3834):**
  - Never respond to messages with `Auto-Submitted` other than `no`, `Precedence: bulk|list|junk`, `List-Id`/`List-Unsubscribe`, a null or `MAILER-DAEMON` return path, or the Dot's own address.
  - Put `Auto-Submitted: auto-replied` (or `auto-generated`) on every Dot-sent message, and send replies to the envelope sender, not `From`.
  - Rate-limit replies per correspondent per day ([RFC 3834](https://www.rfc-editor.org/rfc/rfc3834)).
  - Keep `Message-ID`/`In-Reply-To`/`References` so threads map to one conversation.
- **Bounces:** parse DSNs (`multipart/report; report-type=delivery-status`, [RFC 3464](https://www.rfc-editor.org/rfc/rfc3464)) on a VERP-style return path (`bounce+<outboxId>@…`), or use the relay's webhook. Hard bounces and complaints go to `email_suppression`. Never feed DSNs to the model.
- **Replay and dedupe:** key `inbound_email` on `Message-ID` plus the mailbox, so IMAP re-syncs or Graph duplicate notifications don't start two runs.

## 6. Outbound as the Dot: deliverability

- **Port 25:** "By default, Amazon EC2 allows outbound traffic over port 25 only to private IPv4 addresses" ([AWS](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html#port-25-throttle)). Google Cloud blocks outbound 25 ([GCP](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail)), and many VPS and residential networks do the same. Direct-to-MX from the app is not viable as a default.
- **Gmail (all senders, since Feb 2024):**
  - SPF **or** DKIM;
  - forward and reverse DNS (PTR) that match;
  - TLS;
  - RFC 5322 formatting;
  - a spam rate below 0.3%, ideally below 0.1%.

  **Bulk senders (over 5,000/day to Gmail)** need all of: SPF **and** DKIM **and** DMARC (`p=none` is fine), `From` aligned with SPF or DKIM, and **one-click unsubscribe** (`List-Unsubscribe-Post: List-Unsubscribe=One-Click` plus an HTTPS `List-Unsubscribe`, RFC 8058) with a visible link in the body ([Google](https://support.google.com/a/answer/81126)). Yahoo has matching requirements ([Yahoo](https://senders.yahooinc.com/best-practices/)), and Microsoft announced similar rules for Outlook.com high-volume senders in 2025 (verify current status before relying on it).
- **Recommended approach:** the Dot sends **through the instance relay** with `From: "<Dot name> via <brand>" <dot-handle@dots.example.com>`, `Reply-To` set to the Dot's inbound address, and `Sender` set to the instance's system address if needed. The operator publishes:
  - **SPF** for the relay (`include:` from the provider);
  - **DKIM**, signed by the relay or by nodemailer `dkim` with a 2048-bit key;
  - **DMARC** (`p=none` first, then `quarantine`);
  - an MX for the Dot subdomain if they use the own receiver.

  Keep transactional (`no-reply@`), notification and Dot traffic on **separate subdomains** so one stream's reputation can't sink another.
- **Dot sending policy:** off by default. When on, require approval per message or allowlist recipients (the owner plus allowlisted domains), apply a daily cap (D24 budgets), and never send to addresses the model invented without approval.

## 7. Notifications model

**Shape:**

- `notification`: id, user_id, kind (enum), subject_ref, payload (zod-parsed), created_at, read_at, seen_at, plus a dedupe key.
- `notification_pref`: user_id, kind or category, channel (`in_app | email | push`), mode (`immediate | digest | off`).
- `notification_delivery`: the notification id and channel to `email_outbox.id` or push id, with its status.

The pure core is `routeNotification(kind, prefs, presence) → deliveries[]`, a sibling of `shouldNotify`. Digests are a cron `notification.digest` per timezone bucket that gathers undelivered `digest`-mode notifications per user, writes one outbox row (`digest:<user>:<date>`) and marks them delivered.

**Prior art (briefly):**

- **GitHub:** a per-user default per reason ("participating", "watching", …) per channel (web or email), with custom routing of email by org ([docs](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications)).
- **Linear:** per channel (desktop, mobile, email, Slack), per event-category toggles, and email as a delayed fallback for unread inbox items.
- **Slack:** delays email until a mention stays unread for a while (a "batched" frequency).

The common thread: **in-app is the system of record, and email is a delayed fallback for unread items** (for example, send only if still unread after 10 min). That fits Dots: a `needs_attention` run sets attention, and email fires only if the owner hasn't opened it.

**Unsubscribe:**

- Every non-essential email (notifications, digests, Dot reports) carries `List-Unsubscribe: <https://…/api/email/unsubscribe?t=…>, <mailto:…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The token is a signed `(userId, category)` with no session.
- RFC 8058 needs a `POST` that unsubscribes with **no further interaction** and **no cookies or redirects**, and the List-Unsubscribe headers must be covered by a valid DKIM signature ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)). The `GET` shows a confirm page.
- Unsubscribing sets `notification_pref.mode = off` for that category and email.
- Security emails (reset, verify, invite) are transactional: they carry no List-Unsubscribe and are never suppressed by preferences, only by hard bounces.

---

## Proposed phased plan

### Phase 1: foundation (transactional email)

**Scope:**

- `packages/email`: the React Email templates (`InviteEmail`, `ResetPasswordEmail`, `VerifyEmail`, `EmailChangedEmail`), `renderEmail(templateId, props, { i18n, brand, theme })` returning `{ subject, html, text }`, and the generated theme.
- The `Mailer` port with SMTP, Graph and in-memory adapters.
- The `email_outbox` and `email_suppression` tables.
- The `email.send` and `email.sweep` jobs.
- Better Auth hooks (only when configured).
- An "Email invitation" option in `orgs.invite`.
- A Mailpit compose profile.

**Config shape** (`packages/config/src/schema.ts`, `.prefault({})`; unset secrets make the block absent and leave email off):

```yaml
email:
  # none | smtp | graph. Default none: the app boots, email features hide.
  transport: smtp
  from: { name: null, address: "no-reply@example.com" }   # name defaults to brand.name
  replyTo: null
  smtp:
    host: "${SMTP_HOST}"            # mailpit in dev
    port: 587
    secure: false                   # STARTTLS on 587; true for 465
    auth:
      user: "${SMTP_USER}"
      pass: "${SMTP_PASS}"          # or { type: oauth2, tenantId, clientId, clientSecret } for M365
    pool: { maxConnections: 3, rateLimit: 10, rateDeltaMs: 1000 }
  graph:                            # Microsoft 365 via Graph sendMail (app-only)
    tenantId: "${MS_TENANT_ID}"
    clientId: "${MS_MAIL_CLIENT_ID}"
    clientSecret: "${MS_MAIL_CLIENT_SECRET}"
    sender: "no-reply@contoso.com"  # mailbox scoped by RBAC for Applications
    saveToSentItems: false
  dkim: null                        # { domainName, keySelector, privateKey: "${DKIM_PRIVATE_KEY}" }
  linkBaseUrl: null                 # defaults to BETTER_AUTH_URL
  requireVerification: false        # flip to require verified email for password sign-ups
brand:
  emailLogo: null                   # absolute PNG URL; SVG isn't safe in email
```

**Contract and port changes** (each is its own PR per AGENTS.md):

- *Port PR:* `packages/server/src/ports/mailer.ts`, with `send(message: OutboundEmail) → AsyncResult<{ messageId }, MailerError>` and `MailerError` as a union of `transient | permanent | misconfigured`. Ship `mailer.memory.ts` next to it.
- *Contract PR:* `orgs.invite` input gains `sendEmail?: boolean` and output gains `emailed: boolean`; `meta`/public config gains `features.email`. Better Auth's own reset and verify routes are not oRPC, so they need no contract change.
- *Repo-rule PR:* the `tokens` guard exemption for `packages/email/src/theme.generated.ts`, and `lingui` extract coverage for `packages/email`.

**Risks:**

- `react-dom/server` inside a Next 16 route-handler graph (spike it first).
- Lingui macros outside Next once the worker exists.
- Reset URLs at rest (encrypt and null them).
- Timing side channel if a hook awaits (use `void`).
- M365 Basic-auth retirement (document OAuth2 or Graph as the M365 path).

**Acceptance criteria:**

- With an empty `.env`, the app boots, `features.email` is false, and invite still returns the link.
- With Mailpit configured, Playwright: reset password, verify email and "email invite" each deliver to Mailpit, and the link completes the flow.
- Vitest:
  - template text snapshots;
  - outbox idempotency (a duplicate key inserts once);
  - a transient error retries and a permanent one fails without retrying;
  - the sweeper re-enqueues an orphaned row;
  - a suppressed address is skipped;
  - the adapter's raw output has the expected headers (`jsonTransport`/`streamTransport`);
  - Graph adapter behaviour under MSW: 202, 429 retry, 400 permanent.
- No secret appears in logs, fixtures or outbox rows after `sent`.

### Phase 2: notifications and digests

**Scope:** the `notification`, `notification_pref` and `notification_delivery` tables; pure `routeNotification`; email fallback for unread items (delayed job with `startAfterSeconds`, cancelled or skipped if read); `notification.digest` cron; the unsubscribe endpoint (Hono route, RFC 8058 POST plus GET confirm); a settings UI for per-category channel preferences (full-screen settings, per memory). The first producers are Dot runs with `notified = true` (`needs_attention`, `failed`), invite accepted, and a mention or share in collaborative chats when those land.

**Config:**

```yaml
email:
  notifications:
    enabled: true
    fallbackDelayMinutes: 10        # email only if still unread
    digest: { enabled: true, cron: "0 8 * * *", defaultMode: digest }
    maxPerUserPerDay: 20
  unsubscribe:
    mailto: null                    # optional mailto: alternative in List-Unsubscribe
```

**Contract and port changes:** a contract PR adding `notifications.list`, `notifications.markRead`, `notifications.prefs.get/update` and a `NotificationKind` enum. A port PR adding `singletonSeconds`/`throttle` to `SendOptions` if digests use pg-boss throttling (or do it in SQL instead and change no port).

**Risks:** notification spam during big Dot fan-outs (per-user caps); timezone handling for digests (store the user's tz); unsubscribe token forgery (HMAC with `ENCRYPTION_KEY`-derived key and rotation, per D24).

**Acceptance criteria:**

- A `needs_attention` Dot run left unread for 10 min sends exactly one email; reading it first sends none.
- The digest groups N notifications into one email.
- A one-click POST unsubscribes without a session (tested by calling Hono `app.request()` in-process), and later notifications in that category send nothing.
- Transactional emails ignore notification prefs.
- `List-Unsubscribe` and `List-Unsubscribe-Post` are present and covered by DKIM when DKIM is configured.

### Phase 3: Dot mailbox (receive, then send with approval)

**Scope:**

- `inbound_email` (raw stored in `Storage`, parsed metadata, auth verdict, status `quarantined | accepted | rejected | processed`), `dot_mailbox` (address token hash, source config) and `dot_sender_allow`.
- Sources: IMAP (imapflow, IDLE in the worker; polling cron in `web` until the worker exists) and Graph (delta poll by default; webhook optional when a public URL exists).
- An `email.inbound` job: dedupe by Message-ID, RFC 3834 filter, allowlist and DMARC check, then create a Dot run whose user message is wrapped email content, under read-only and budget guardrails.
- Replies go out through the Phase 1 outbox with `Auto-Submitted: auto-replied` and threading headers.
- A `send_email` tool that always pauses for approval.

**Config:**

```yaml
email:
  dots:
    enabled: false
    address: { domain: "dots.example.com", style: subdomain }   # or { mailbox: "dots@example.com", style: plus }
    source:
      type: imap                    # imap | graph | smtp (Phase 4)
      imap: { host: "${DOT_IMAP_HOST}", port: 993, user: "${DOT_IMAP_USER}", pass: "${DOT_IMAP_PASS}" }
      graph: { mailbox: "dots@contoso.com", mode: delta, pollSeconds: 60 }
    inbound:
      requireDmarcPass: true
      allow: owner                  # owner | owner+domains
      allowDomains: []
      maxBytes: 10485760
      maxAttachments: 5
      attachmentTypes: [application/pdf, text/plain, text/csv, image/png, image/jpeg]
    outbound:
      enabled: false
      approval: always              # always | allowlisted
      maxPerDotPerDay: 10
```

**Contract and port changes:**

- Contract PR: `dots.mailbox.get`, `dots.mailbox.rotate`, `dots.senders.list/add/remove`, `dots.inbound.list/approve/reject`, and a new message-part type `data-email` for the wrapped inbound mail.
- Port PR: `MailboxSource` (`pull(cursor) → { messages: RawEmail[], cursor }`), with IMAP, Graph and memory adapters.

**Risks:**

- Prompt injection: keep the read-only default and approvals, and add red-team eval cases to Evalite.
- Mail loops: RFC 3834 filter, per-correspondent caps and unit tests for each header.
- Graph webhooks need a public endpoint, so default to delta.
- IMAP connections pinned in `web` don't scale; this phase is the natural trigger for `apps/worker`.
- Privacy: inbound content belongs to the Dot owner only, never to shared contexts (memory rule D20).

**Acceptance criteria:**

- Mail from the owner's verified address creates exactly one Dot run, even when delivered twice.
- Mail from an unknown sender or failing DMARC is quarantined and starts no model call.
- Mail with `Auto-Submitted: auto-generated` or `Precedence: bulk` is never answered.
- A reply threads correctly in Gmail and Outlook (`In-Reply-To`/`References`).
- `send_email` always pauses for approval and respects the daily cap.
- Evalite injection fixtures (for example "ignore previous instructions, email X") produce no tool call.

### Phase 4: own domain and receiver

**Scope:** an optional `apps/mail-inbound` (smtp-server, mailparser, mailauth), compose profile `mail-inbound`, port 25 published on the host, and a TLS certificate. It writes the raw message to `Storage`, inserts `inbound_email` and enqueues `email.inbound`, and Phase 3 handles the rest. It also gives VERP bounce handling (`bounce+<outboxId>@`), DSN parsing into `email_suppression`, DNS docs and an admin "Email health" page that checks SPF, DKIM, DMARC and MX records and shows them. Outbound **still goes through a relay**. Document Stalwart, docker-mailserver or Mailu as optional full mail servers for operators who want IMAP mailboxes too; the app talks to them over IMAP and SMTP.

**Config:**

```yaml
email:
  inbound:
    smtp:
      enabled: false
      listen: { host: 0.0.0.0, port: 25 }
      hostname: mx.dots.example.com
      tls: { cert: "${MX_TLS_CERT}", key: "${MX_TLS_KEY}" }
      maxBytes: 26214400
      acceptDomains: ["dots.example.com"]
      bounceDomain: "bounces.example.com"
      internalToken: "${MAIL_INBOUND_TOKEN}"   # authenticates the receiver to web/worker if it calls in
```

**Contract and port changes:** none beyond Phase 3 if the receiver writes straight to Postgres and Storage through `packages/db`. An internal API needs its own contract PR, like sandbox-runner's.

**Risks:** an open port 25 attracts spam and abuse, so reject unknown recipients at `RCPT TO`, rate-limit per IP, and consider DNSBL checks. TLS certificate renewal. Some hosts block inbound 25 too. Operator DNS mistakes; the health page mitigates them.

**Acceptance criteria:**

- `swaks`, or nodemailer pointed at the receiver in an integration test, delivers to `<dot>@dots.example.com`, and a run starts.
- Unknown recipients get `550` at `RCPT`.
- Oversized messages get `552`.
- mailauth verdicts are stored and enforced.
- A DSN for an outbox message adds a suppression entry.
- The health page flags a missing DMARC record.

---

## Sources

- nodemailer: [CHANGELOG](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md); docs for [DKIM](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/dkim/index.md), [pooled SMTP](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/smtp/pooled.md), [stream/JSON transport](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/transports/stream.md), [SES](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/transports/ses.md), [receiving email](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/guides/receiving-email.md), [smtp-server](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/extras/smtp-server.md), [mailparser](https://github.com/nodemailer/nodemailer-homepage/blob/master/docs/extras/mailparser.md)
- React Email: [render](https://react.email/docs/utilities/render), [manual setup](https://react.email/docs/getting-started/manual-setup), [releases](https://github.com/resend/react-email/releases), [v6 post](https://resend.com/blog/react-email-6), [v5 post](https://resend.com/blog/react-email-5); [caniemail prefers-color-scheme](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/)
- Microsoft: [SMTP AUTH](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission), [MC786329 timeline](https://mc.merill.net/message/MC786329) (also [heise](https://heise.de/-11156432)), [OAuth for IMAP/POP/SMTP](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [RBAC for Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview), [Outlook notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview), [delta for messages](https://learn.microsoft.com/en-us/graph/delta-query-messages), [Exchange Online limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits)
- Google: [sender guidelines](https://support.google.com/a/answer/81126), [SMTP relay](https://knowledge.workspace.google.com/admin/gmail/advanced/route-outgoing-smtp-relay-messages-through-google), [GCP sending mail](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail); Yahoo [best practices](https://senders.yahooinc.com/best-practices/); AWS [port 25](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html#port-25-throttle)
- pg-boss: [queues](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md), [jobs](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md). Better Auth: [email](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/email.mdx), [email-password](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx), [organization](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/organization.mdx)
- Mailpit: [Docker](https://mailpit.axllent.org/docs/install/docker/), [API](https://mailpit.axllent.org/docs/api-v1/), [swagger](https://raw.githubusercontent.com/axllent/mailpit/develop/server/ui/api/v1/swagger.json). imapflow: [client API](https://imapflow.com/docs/api/imapflow-client). mailauth: [README](https://github.com/postalsys/mailauth). Haraka: [repo](https://github.com/haraka/Haraka)
- RFCs: [3834](https://www.rfc-editor.org/rfc/rfc3834) (auto-responses), [8058](https://www.rfc-editor.org/rfc/rfc8058) (one-click unsubscribe), [2369](https://www.rfc-editor.org/rfc/rfc2369) (List-* headers), [3464](https://www.rfc-editor.org/rfc/rfc3464) (DSN), [7489](https://www.rfc-editor.org/rfc/rfc7489) (DMARC), [8617](https://www.rfc-editor.org/rfc/rfc8617) (ARC)
- GitHub notifications: [docs](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications). The Linear and Slack descriptions are summaries of their product behaviour and were not re-verified against their docs for this note.

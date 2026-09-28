---
id: "054"
title: "Sign-in from 127.0.0.1 fails with \"Something went wrong\""
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-09-28, demo): signing in on the Docker demo at `http://127.0.0.1:3000` showed only "Something
went wrong. Try again." The log said `ERROR [Better Auth]: Invalid origin: http://127.0.0.1:3000`, because
`trustedOrigins` is just `[BETTER_AUTH_URL]` (`http://localhost:3000`, `packages/auth/src/server.ts`). The
same happens behind any second hostname.

## Done when

- When `BETTER_AUTH_URL` is a loopback origin (`localhost`, `127.0.0.1`, `[::1]`), the same scheme and port on
  the other loopback names is trusted too. Non-loopback deployments stay exact.
- Extra origins can be trusted explicitly (e.g. `BETTER_AUTH_TRUSTED_ORIGINS`, comma-separated, documented in
  `.env.example`, `docs/self-hosting.md` and the setup CLI's doctor hint), validated as origins.
- The sign-in and sign-up pages show a specific, translated message for an origin rejection ("This address isn't
  allowed to sign in. Open <BETTER_AUTH_URL> instead" or similar, with the configured URL) and a readable message
  for other auth errors, instead of the generic text. Lingui extract stays clean.
- Tests: unit tests for the origin list; an e2e step that signs in via `127.0.0.1` on the e2e server. Local gate passes.

## Owns

`packages/auth/src/**`, the sign-in / sign-up UI (`apps/web` auth routes and whatever package renders the forms),
`packages/i18n` catalogs, `.env.example`, `docs/self-hosting.md`, `packages/setup/src/doctor.ts`, `e2e/**`.

## Results

- **Fix** (`packages/auth/src/origins.ts`, `server.ts`): Better Auth's `trustedOrigins` is now
  `BETTER_AUTH_URL`'s origin plus, when that origin is `localhost` / `127.0.0.1` / `[::1]`, the other two
  on the same scheme and port. Other hosts stay exact. `TRUSTED_ORIGINS` (comma- or space-separated) adds
  exact origins, parsed with a zod `originSchema`. Paths, queries, credentials, non-http(s) schemes and `*`
  are ignored, with a warning at boot. The name is `TRUSTED_ORIGINS`, not `BETTER_AUTH_TRUSTED_ORIGINS`,
  because Better Auth reads that one from `process.env` itself, unchecked and wildcards included, so
  validating it would mean nothing. If it's set, the app now warns. `advanced.disableOriginCheck: false`
  keeps the origin checks on under `NODE_ENV=test` (Better Auth turns them off there), so the tests
  exercise them. The auth, server and full suites pass with that on.
- **Messages** (`apps/web/app/(auth)`): `INVALID_ORIGIN` / `MISSING_OR_NULL_ORIGIN` → "This address isn't
  allowed to sign in. Open <BETTER_AUTH_URL> instead." The address links to the same page on that origin.
  Without a `BETTER_AUTH_URL` the message says to use the address the administrator gave, or to ask them to
  add this one to trusted origins. The sign-in and sign-up pages read the URL server-side
  (`appOriginOf(process.env.BETTER_AUTH_URL)`) and pass it as a prop, so public config and
  `packages/contract` are unchanged. New readable messages: invalid email, password too long, too many
  attempts (429), server error (5xx), server unreachable (fetch rejected). Lingui catalog extracted.
- **Docs**: `.env.example`, `docs/self-hosting.md` ("Addresses that can sign in", under "Behind a proxy"),
  `e2e/README.md`. `bun run setup doctor` gains a "Sign-in address" check. It shows the address to open and
  the loopback aliases, points to `TRUSTED_ORIGINS` for other addresses, and warns on a loopback
  `BETTER_AUTH_URL` whose port isn't the served one or on `BETTER_AUTH_TRUSTED_ORIGINS`. It fails on a
  `BETTER_AUTH_URL` that isn't a URL.
- **Tests**: `origins.test.ts` (the list: loopback expansion, exact non-loopback including lookalikes like
  `app.localhost` / `127.0.0.2`, extras, rejects, dedupe). `server.test.ts` covers sign-up over the real
  handler from `127.0.0.1` / `[::1]` (200), another port (403 `INVALID_ORIGIN`), a public URL (loopback
  refused, a listed extra accepted, a wildcard ignored with a warning) and the `BETTER_AUTH_TRUSTED_ORIGINS`
  warning. Web: `auth-errors.test.ts` and `auth-forms.test.tsx` (the origin message with its link, the
  no-URL variant, unreachable). Setup: `doctor.test.ts`. E2E: `shell.spec.ts` signs in at
  `http://127.0.0.1:<port>` (200, the composer appears) and checks the refusal at
  `http://e2e.localhost:<port>` (403, the message, a link to `http://localhost:<port>/sign-in?next=%2F`).
  `bun turbo test:e2e`: 25 passed.
- **Outside Owns**: `packages/setup/src/doctor.test.ts` and the two setup snapshots
  (`doctor.test.ts.snap`, and `plan.test.ts.snap`, because setup writes `.env` from `.env.example`). They
  change only because the owned files changed.
- **Gate**: passes (82/82). Two earlier gate runs failed once each in `@workspace/db#test`, which passes on
  its own and in a full `--continue` run. That looks like flakiness under load, unrelated to this change.

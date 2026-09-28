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

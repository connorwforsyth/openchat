---
id: "186"
title: "Sign in with Microsoft (Entra ID) via Better Auth"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-20): "set up another adapter/module to help people connect to Azure Active Directory (Microsoft Entra ID) with Better Auth — pull in their Microsoft profile pictures etc. It should be a simple adapter that just works as a sign-in with SSO when applied." D22 lists generic OIDC, which Entra already works with, but that path doesn't fetch photos, check tenants, or come with a guide. Better Auth 1.7.6 ships a `microsoft` social provider; use that rather than `genericOAuth`.

## Done when

- **Config:** `auth.microsoft` in app.config.yaml with `clientId`/`clientSecret` (from `${ENV}`), `tenantId` (`common` | `organizations` | `consumers` | a tenant GUID or domain), `allowedDomains`, `allowedTenants`, `autoProvision`, `name` (the button label), `photo { enabled, maxBytes }` and `enabled`. It's a zod schema. With no block, or with the credentials unset, the app boots exactly as before. `autoProvision` and `signup: sso` need a pinned tenant (a specific `tenantId` or `allowedTenants`); `allowedDomains` is a filter and doesn't count, because any tenant can give its users any email (nOAuth).
- **Adapter:** `microsoftSso(config, { fetch, avatars, warn })` returns Better Auth's provider options, a `validateUserInfo` refusal and an account-row filter.
  - The tenant and domain allow-lists apply to every sign-in, sign-up and link.
  - An invitation or `signup: domain` matches a Microsoft email only from a pinned tenant or when the token verifies the email.
  - A sign-in whose directory email belongs to another account is refused with `microsoft_email_in_use`.
  - `user.syncedName` and `user.syncedImage` are `input: false`; only the `user` database hooks write them, during a Microsoft sign-in.
  - Email follows the directory. Name and photo follow it until the person edits them: each sign-in records what it copied (`user.syncedName`, `user.syncedImage`) and only replaces a field that still equals that record. When Microsoft has no photo, a synced one is removed and the person's own is kept (defaults, see QUESTIONS-FOR-CONNOR).
  - The Graph photo is copied into Storage under `avatars/`, keyed by `oid` and the photo's ETag, so a later sign-in only re-downloads it when it has changed. A 404 is treated as no photo, and an oversized photo or anything that isn't an image is skipped. None of these blocks sign-in.
  - Microsoft's tokens are never stored.
- **Serving:** `GET /api/avatars/<key>` is for signed-in people only and serves images only, with `nosniff` and a sandbox CSP.
- **UI:** "Continue with Microsoft" with the Microsoft mark, only when configured. Settings → Profile gets a "Connected accounts" card. Lingui strings throughout.
- **Docs:** a guide in `docs/self-hosting.md` (Azure app registration, redirect URI, Graph scopes, environment variables), plus the commented block in `app.config.example.yaml`.
- **Tests:**
  - Config parsing: absent, present, interpolated-empty and invalid.
  - The allow-list.
  - Photo success, unchanged, 404, oversize and not-an-image, with MSW.
  - The full callback through Better Auth: the photo is stored, no tokens are kept, the user is refreshed on the next sign-in, and refusals redirect with an error code.
  - Registration only when configured, the avatar route, button visibility and the connected-accounts list.

## Owns

`packages/config/src/microsoft*.ts`, `packages/auth/src/microsoft*.ts`, and the Microsoft wiring in `packages/auth/src/{server,signup}.ts`, `packages/config/src/{schema,public}.ts` and `packages/server/src/server.ts`. Also `packages/server/src/http/avatars*.ts`, `apps/web/app/(auth)/_components/social-buttons.tsx`, `apps/web/app/(app)/(pages)/settings/_components/connected-accounts.tsx`, the Microsoft section of `docs/self-hosting.md`, `app.config.example.yaml` and `.env.example`.

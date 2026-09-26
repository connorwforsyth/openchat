# Questions for Connor

Collected by agents working the map, so you can answer them in one sitting. Each links to its ticket. Answer inline and the loop picks the answers up.

## Waiting on you now

1. **App shell prototype ([009](tickets/009-prototype-app-shell.md)):** run `/wayfinder` on this ticket whenever you like; it doesn't need the scaffold.
2. **Agent Builder prototype ([010](tickets/010-prototype-agent-builder.md)):** same.
3. **Theme preset (002):** the scaffold uses shadcn's default preset. When you've picked one on ui.shadcn.com/create, paste the preset code here and the loop runs `shadcn apply`.

## From the loop

4. **Offline builds (002):** `next/font/google` downloads the Geist fonts at build time, so builds fail offline or in locked-down CI. Switch to the `geist` npm package (self-hosted fonts)? *Loop default if unanswered: yes, being done inside ticket 006.*
5. **Node version (002):** `engines` says Node `>=22` (this Mac has 22; CI and the containers use 24). OK? *Default: keep.*
6. **SearXNG image (002):** the compose file uses `searxng/searxng:latest`. Pin a version? *Default: pin to the current release when 021 (web search) lands.*
7. **gVisor (003, PARTIAL):** gVisor runs on Linux 5.6+ hosts (a normal VPS is fine) but can't be installed on Docker Desktop for macOS. The Docker sandbox on your Mac will fall back to plain `runc` with hardening and an admin warning, as `PLAN.md` D7 already says. Nothing to decide unless you want macOS sandboxes to use a Linux VM. [decision 0005](../docs/decisions/0005-gvisor-availability.md)
8. **bun linker for Expo (003):** Expo 57 works with bun's isolated linker (the repo's default), but `expo-doctor` warns about duplicates; the hoisted linker clears it. *Default: leave isolated; revisit in the Mobile wave.*
9. **Postgres version in tests (003):** PGlite is Postgres 18.3, production is 17. *Default: 011 adds a Postgres 17 job to CI for anything version-sensitive.*
10. **Status colours (007):** the theme has no success/warning tokens, so tool status uses the nearest semantic tokens. Add `--success` and `--warning` to `globals.css` (they'd come from your preset)? *Default: add them when you pick a preset.*
11. **RTL in shadcn primitives (007):** stock shadcn components still use physical `pl-`/`pr-`. Turn on shadcn's `rtl` option now, or in the open-source wave with the RTL pseudo-locale? *Default: open-source wave.*
12. **`/dev/*` routes (007):** the AI Elements demo at `/dev/ai-elements` is noindex but reachable in production. Gate `/dev/*` behind an env flag? *Default: gate it in 025 (integration).*
13. **Model proxy usage links (027):** should `/api/llm` requests carry an optional `conversationId`/`runId` so usage rows point at a chat? Adding it later is non-breaking. *Default: add it when the desktop wave builds the client.*
14. **Search language (011):** full-text search uses Postgres's `simple` configuration (no stemming, works for any language). `english` would match "running" to "run" but only for English. *Default: keep `simple` until other languages matter.*
15. **No database configured (011):** with an empty `DATABASE_URL`, should the app fall back to a file-backed embedded Postgres (PGlite in `./.data`) so `bun dev` works with zero setup? *Default: yes, done in 025 (integration).*
16. **Invitations without email (012):** there's no mail transport yet, so accepting an invite doesn't require a verified email. Anyone who knows an invited address could sign up with it and take the invite. Give invitations a separate random token (sent as a link), or add mail sending in M1? *Default: random invite token + link in M1; mail later.*
17. **Social sign-in config (012):** `auth.social.github` with unset env vars currently fails config validation, and env-only providers don't show in public config. *Default: fix in `packages/config` during 024 (settings/admin).*
18. **Personal org in lists (012):** `me.orgs` includes your personal org (flagged); `orgs.list` leaves it out. *Default: keep.*
19. **`auto` with no Decider opinion (013):** routes to the strong model. Cheap instead? *Default: strong (quality over cost).*
20. **Model proxy provider options (013):** the proxy strips a denylist of risky provider options. Drop call-level `providerOptions` entirely? *Default: keep the denylist.*
21. **Imported attachments (023):** exports don't contain the files, so attachments import as metadata-only `data` parts. Allow a file part with a "missing" source instead (contract change)? *Default: keep data parts.*
22. **Fork modes (023):** add a `mode` (direct path / include branches / target level) to the fork input (contract change)? *Default: direct path only for now.*
23. **Forking someone else's chat (023):** the copy should land in the forker's Personal context. *Default: yes, enforced in 025.*

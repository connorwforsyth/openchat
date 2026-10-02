# T3 Code remote access and mobile, compared with openchat

Nothing was edited in either repo. T3 paths are relative to `/tmp/study/t3code`, openchat paths to `/Users/connorforsyth/GitHub/openchat`.

## 0. Framing: what transfers and what doesn't

In T3 Code, each **environment** (a server process on someone's machine) belongs to one user. Its "auth" is pairing a device to that one owner, not user accounts. The **relay** ("T3 Connect") exists to reach laptops sitting behind NAT. openchat is the reverse: a multi-user server already reachable over HTTPS, with Better Auth accounts, orgs and `resource_grant`.

- **Mostly doesn't transfer:**
  - the Cloudflare-tunnel relay;
  - Clerk as the cloud identity;
  - `packages/ssh`, the desktop spawning a remote server over SSH;
  - DPoP-bound bootstrap credentials.
- **Transfers well:** the client-side connection runtime, offline send queue, protocol versioning, mobile build discipline, device-session hygiene and push-notification design.

Key T3 docs: `docs/internals/{t3-connect,environment-auth,connection-runtime,remote,mobile-development,mobile-navigation}.md`, `docs/user/{remote-access,mobile-notifications}.md`.

## 1. How T3 works (brief)

**Auth model** (`packages/contracts/src/auth.ts`, `apps/server/src/auth/*`)

- The server advertises a `ServerAuthDescriptor`, which tells clients which pairing and session methods to use:
  - `policy`: `desktop-managed-local` | `loopback-browser` | `remote-reachable` | `unsafe-no-auth`;
  - `bootstrapMethods`: `desktop-bootstrap` | `one-time-token`;
  - `sessionMethods`: `browser-session-cookie` | `bearer-access-token` | `dpop-access-token`.
- Scopes: `orchestration:read/operate`, `terminal:operate`, `review:write`, `access:read/write`, `relay:read/write`. Every WebSocket RPC must declare one. Leaving it out is a *type error* (`apps/server/src/auth/RpcAuthorization.ts`).
- Pairing grants (`PairingGrantStore.ts`) are one-time tokens with a 5-minute TTL, consumed atomically.
  - Exchanging a grant can narrow its scopes but never widen them.
  - Making a pairing link requires `access:write` plus every scope being delegated.
  - The connections list never returns pairing secrets.
- Sessions last 30 days. WebSocket tickets last 5 minutes and are minted over authenticated HTTP, so long-lived tokens stay out of socket URLs (`SessionStore.ts:423-424`).
- Pairing URLs carry the secret in the **fragment** (`#token=`), never the query, so it isn't sent to the hosting origin (`apps/web/src/hostedPairing.ts`).
- Mobile parses a QR code or pasted URL (`apps/mobile/src/features/connection/pairing.ts`). Its catalog and tokens live in `expo-secure-store` (`apps/mobile/src/connection/catalog-store.ts`, `persistence/mobile-secure-storage.ts`).

**Clerk** is used only for the cloud account behind T3 Connect: `@clerk/expo` with `tokenCache` (`apps/mobile/src/features/cloud/CloudAuthProvider.tsx`). It is never used to log in to an environment ("A relay token is never an environment login").
- The CLI logs in with OAuth PKCE through a loopback callback.
- Over SSH or headless it uses the OAuth device-code grant (`packages/shared/src/connectAuth.ts`).

**The relay** (`infra/relay`) is a Cloudflare Worker plus queues, PlanetScale, Axiom and Alchemy. It:
- links environments to accounts and provisions Cloudflare tunnels;
- asks the environment to mint a DPoP-bound one-time credential, which the client redeems *directly* with the environment;
- holds APNs and FCM device registrations and delivers push and Live Activities.

It stays out of the hot path: after bootstrap, traffic goes straight through the tunnel. Notable details: a reaper for idle paid tunnels, generation counters against teardown races, no redirect-following, and loopback-only origins.

**Other routes in** (`docs/user/remote-access.md`):
- LAN or Tailscale pairing via `t3 serve --host`, `t3 pair` and `--tailscale-serve` (`packages/tailscale`).
- `dev:share` wraps `tailscale serve` around the dev web port so a phone can open the dev server (`scripts/lib/dev-share.ts`, `scripts/dev-runner.ts:709-776`).
- SSH, owned by desktop main: it forwards a port and stops the remote server only if it launched it (`packages/ssh/src/tunnel.ts`).

**Shared client runtime** (`packages/client-runtime`): web, desktop and mobile share one connection owner per environment.
- Platform code injects storage, credentials, network signals and app-lifecycle "wakeups" as Effect services (`apps/mobile/src/connection/platform.ts`).
- The supervisor (`connection/supervisor.ts`) is the single retry owner:
  - capped backoff at 3, 4, 8 then 16 s;
  - offline or auth failures wait for a wakeup instead of burning retries;
  - on foreground it probes (3 s timeout on mobile), or forces a reconnect after 10 s or more in the background, because the OS kills sockets silently (`apps/mobile/src/connection/app-state-wakeups.ts`).
- Transport health and data freshness are tracked separately.
- Cached projections stay readable offline but never overwrite newer live data.
- Thread caches keep their replay cursor for 5 idle minutes.
- Mutations are never replayed automatically on reconnect.

**Offline outbox** (`apps/mobile/src/state/thread-outbox-*.ts`):
- Queued messages are written atomically to files, with schema versions (v1–v4 readable, v3 written "until a compatible native baseline includes the v4 reader").
- They drain on reconnect with up to 16 s backoff, and writes are flushed before an OTA restart.

**Protocol compatibility:** `ORCHESTRATION_PROTOCOL_VERSION` is sent on the socket. On a mismatch the client is blocked with a "update your app" or "update the server" message (`packages/client-runtime/src/connection/compatibility.ts`). The doc rule: "Remote servers can outlive several client releases; use advertised capabilities."

**Push** (`apps/mobile/src/features/agent-awareness/*`, `infra/relay/src/agentActivity/*`):
- Raw device tokens via `getDevicePushTokenAsync`. There is no Expo push service; the relay talks to APNs and FCM directly.
- Alert types: finished, failed, needs approval, asks for input.
- Alerts are quiet while the app is in the foreground. Tapping one deep-links to the thread.
- Live Activities on iOS, ongoing notifications on Android.
- Payload text is truncated.
- Push only works with T3 Connect, not with direct connections.

**Mobile stack and UI:**
- Expo 58, RN 0.88-rc, Uniwind, `@legendapp/list`, Reanimated 4.
- T3 moved *off* Expo Router to a react-navigation static native stack (`apps/mobile/src/Stack.tsx:794` mentions "the expo-router era"). This was to keep UIKit header transitions in one navigation controller (`docs/internals/mobile-navigation.md`).
- Heavy native investment: eight local modules (`apps/mobile/modules/`: markdown, diff, terminal, composer, widgets and others), plus patches to react-native-screens and uniwind.
- Separate Android Material components (`*.android.tsx`).
- Themes are *generated* into a committed Uniwind CSS file plus `clerk-theme.json` (`apps/mobile/scripts/generate-uniwind-themes.mts`).

**Build pipeline:**
- `eas.json` has `development`, `preview`, `preview:dev` and `production` profiles, installable side by side with different schemes and bundle IDs.
- `runtimeVersion` uses the `fingerprint` policy, so OTA updates only reach binaries with matching native code.
- `.github/workflows/mobile-fingerprint-check.yml` labels PRs that change native code ("📱 Native Change") so they can be batched before a store submission and `main` stays OTA-able. Its inputs include `packages/contracts` and `packages/client-runtime`.
- `mobile-eas-preview.yml` builds only when a PR has a label.
- `scripts/mobile-native-client.ts ensure` rebuilds the dev client only when its fingerprint is stale.

**Mobile tests and checks:**
- 192 colocated Vitest unit tests. No Maestro or Detox.
- `scripts/mobile-native-static-check.ts` runs swiftlint, ktlint and detekt, and warns if a tool is missing. CI runs it on a macOS runner only when native paths changed, and fails open.
- `scripts/mobile-showcase.ts` seeds fake environments and automates store screenshots on simulators.

## 2. openchat today

- **`packages/auth/src/server.ts`:** Better Auth with `organization`, `admin` and `bearer()` (line 290). Expo and Electron plugins are planned (PLAN D22).
- **`packages/client`:** an oRPC `OpenAPILink` client with cookie credentials and an injectable `headers()` for bearer tokens (`api.ts`).
  - `run-stream.ts` resumes with `?cursor=` and retries.
  - `run-transport.ts` is a `useChat` transport.
  - `createRunInputSchema` already has an `idempotencyKey` (`packages/contract/src/schemas/runs.ts:276`).
- **`apps/desktop`:** loads one remembered instance URL. System-browser PKCE is a follow-up (`apps/desktop/README.md`).
- **`publicConfigSchema`** (`packages/contract/src/schemas/meta.ts:78`): has no API or protocol version and no capability list.
- **PLAN:**
  - Mobile wave (`PLAN.md:89`): Expo 57, RN Reusables + Uniwind, `useChat` with `expo/fetch`, `'use dom'` for Markdown and artifacts, Better Auth Expo, a generated Uniwind token file, Maestro (`PLAN.md:280`).
  - Collaboration wave: notifications via web push, Expo push and email.
  - QUESTIONS #8: whether bun's isolated linker works with Expo.

## 3. Recommendations, ranked by value

**1. Make `packages/client` the connection runtime for every platform. (High; Mobile wave, but shape it now.)**
- T3 does this in `packages/client-runtime/src/connection/{supervisor,wakeups,registry,connectivity}.ts`; `docs/internals/connection-runtime.md` explains it.
- openchat already has per-stream resume, but nothing owns reconnects across streams, and there is no foreground/network signal.
- Adopt, following openchat's "ports are function arguments" rule:
  - a small `ConnectionSignals` port (network status, app-active, credentials-changed) that web, Electron and Expo each implement;
  - one retry owner per instance, with "probe on short background, force reconnect after about 10 s";
  - separate "transport healthy" from "data fresh" in UI state;
  - persisted caches never overwrite newer live data.
- This applies directly to D4 runs and the D25 SSE events channel.

**2. API version and capability negotiation in `publicConfig`. (High; needs its own contract PR.)**
- T3 does this in `compatibility.ts`, `ServerAuthDescriptor` and `docs/internals/remote.md`.
- For a self-hosted product the risk is sharper: one App Store binary talks to many servers on different versions.
- Add `apiVersion` (an integer) plus a `capabilities` list (for example `runs.resume`, `events.sse`, `auth.expo`, `push.expo`) to `/api/config`.
- The mobile and Swift clients block with "update the app" or "ask your admin to update the server" messages.
- Per AGENTS.md this is a contract change, so it must be its own PR. Do it before the first mobile store build.

**3. Offline outbox built on the existing `idempotencyKey`. (High; Mobile wave.)**
- T3 does this in `apps/mobile/src/state/thread-outbox-{model,storage,manager}.ts`.
- openchat's server half is done: `createRun` already dedupes by key. On the client:
  - persist queued turns (zod schema with `schemaVersion`, atomic writes) keyed by instance and conversation;
  - drain them on reconnect;
  - never auto-replay non-idempotent mutations.
- Note T3's "write v(n-1), read v(n)" rule, which keeps OTA updates compatible with older binaries.

**4. Mobile build discipline: EAS variants, fingerprint runtime version, native-change labelling. (High; Mobile wave.)**
- T3 sources: `apps/mobile/eas.json`, `app.config.ts` (`APP_VARIANT`, fingerprint policy), `.github/workflows/mobile-fingerprint-check.yml`, `scripts/mobile-native-client.ts`.
- Copy this nearly as-is. Brand rule D18 applies: bundle IDs and schemes must come from the `brand:` block.
- Include `packages/contract` and `packages/client` in the fingerprint inputs, as T3 does.
- Gating the macOS-billed native lint on changed paths is a cheap CI win.

**5. Device-session hygiene for mobile and Swift sign-in. (Medium-high; Mobile wave.)**
- T3 sources: `environment-auth.md`, `PairingGrantStore.ts`, `SessionStore.ts`.
- Transferable even with Better Auth accounts:
  - **Short-lived stream tickets.** SSE and `EventSource`, `<img>`, and artifact iframes can't send headers. Mint a ticket of about 5 minutes over authenticated HTTP rather than putting the bearer token in a URL. This matters for Swift and RN image loaders too.
  - **Secrets in URL fragments**, for invite and share links that land on a hosted page.
  - **A "Devices / sessions" settings page** showing client metadata, with per-device revocation. Better Auth `listSessions`/`revokeSession` covers it. T3's rule that metadata labels carry no authority is worth stating.
  - **Optional "scan QR to sign in on phone".** A signed-in web session mints a single-use grant (5 minutes, consumed atomically, at most the issuer's own access), and the phone exchanges it for a bearer session. This saves typing an instance URL and doing SSO on a phone. It adds to Better Auth Expo rather than replacing it. Needs a contract PR.
- **Defer DPoP.** It earns its keep in T3 because a third-party relay brokers credentials, and openchat has no relay.

**6. Multi-instance client catalog from day one. (Medium; Mobile wave.)**
- T3 sources: `packages/client-runtime/src/connection/{catalog,registry}.ts`, `apps/mobile/src/connection/catalog-store.ts`.
- openchat's desktop remembers one URL. On mobile, users will plausibly have a work instance and a personal one.
- Key the mobile cache, outbox, drafts and SecureStore entries by `instanceId` (the server's stable ID from `/api/config`) from the start.
- "Remove instance" clears everything stored for it. "Sign out" keeps the instance entry.
- This is cheap now and a migration later. T3 needed `apps/mobile/src/connection/migration.ts`.

**7. Push notification design. (Medium; Collaboration wave.)**
- T3 sources: `apps/mobile/src/features/agent-awareness/*`, `infra/relay/src/agentActivity/*`.
- T3 had to build a relay because a laptop can't hold APNs keys. openchat's server can send push directly, so **Expo push from each instance** (as planned) is correct and needs no relay.
- **Flag:** the Expo push service is a free hosted third party that sits in the path, so confirm it fits the "OSS only, no paid service" rule. Offer an admin switch to turn it off.
- Copy T3's product rules:
  - notify on finished, failed, needs approval and asks for input;
  - suppress in the foreground;
  - tap deep-links to the conversation and branch;
  - minimal payload (title and status only; fetch content on open, which also keeps chat text out of Apple and Google);
  - unregister on sign-out (`unregisterAgentAwarenessDeviceForCurrentUser`).
- iOS Live Activities for long runs are a nice later addition.

**8. Mobile UI architecture lessons. (Medium; Mobile wave.)**
- T3 sources: `docs/internals/mobile-navigation.md`, `mobile-development.md`, `apps/mobile/modules/`.
- T3 left Expo Router for a single native stack to keep header transitions smooth. Expect friction there, but keep Expo Router unless the same UIKit header issues appear.
- T3 rendered Markdown and diffs **natively** for performance. openchat's plan uses `'use dom'` for Markdown. Keep `'use dom'` for artifacts, but benchmark a long message list early and have a native-markdown fallback ready.
- A generated, committed Uniwind theme file matches openchat's plan. T3 also generates the auth-UI theme from it. Budget for Uniwind HMR quirks (`patches/uniwind@1.11.0.patch`).

**9. `dev:share` over Tailscale for phone testing. (Low-medium; any time.)**
- T3 sources: `scripts/lib/dev-share.ts`, `packages/tailscale`.
- Expo on a real phone needs to reach the Next dev server. An optional `bun dev --share` that wraps `tailscale serve`, with cleanup on exit and stderr scrubbed of secrets, is small and handy.
- Also document Tailscale as a deployment option for self-hosters who don't want public exposure.

**10. Testing approach. (Low-medium.)**
- T3 relies on unit tests plus screenshot automation (`scripts/mobile-showcase.ts`) and native linters. It has no end-to-end tests.
- openchat's planned Maestro covers the "resume after backgrounding" demo gate, which T3 doesn't test at all, so keep it.
- Add the showcase-seed approach for store screenshots.

## 4. Don't adopt

- **The T3 Connect relay as a whole:** Cloudflare tunnels, PlanetScale, Clerk, and a tunnel reaper that exists to save money. These are paid services solving a NAT problem openchat doesn't have.
- **Clerk:** Better Auth already covers identity.
- **`packages/ssh` remote-server launching:** openchat's server is not per-user.
- **The pairing-only environment auth model:** single-owner. openchat's `resource_grant` and org roles are richer, and T3's scopes are a coarser version of the same idea.
- **The reusable dev auth token** (`T3CODE_DEV_AUTH_TOKEN`): unnecessary when dev has real accounts.

## Suggested sequencing

| When | What |
|---|---|
| Now (small) | #2 contract PR (`apiVersion` and `capabilities`) |
| Collaboration wave | #1 runtime port shape in `packages/client`; #5 stream tickets, when the D25 SSE events channel lands; #7 push |
| Mobile wave | #3, #4, #6, #8 |
| Any time | #9 |

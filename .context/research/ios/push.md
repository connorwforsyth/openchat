# Push from a self-hosted instance: APNs and web push, OSS only

Research for ticket 183 (`.wayfinder/tickets/183-push-from-self-hosted.md`, map
179 `.wayfinder/ios-map.md`). Input to 191 (contract), 192 (server sends push)
and 186 (Apple key setup). Researched 2026-10-20. Nothing outside this file was
edited.

Builds on `.context/research/t3code/remote-mobile.md` §3.7 ("Push notification
design"). That note assumed Expo push and flagged it as a hosted third party.
The SwiftUI decision (map 179) removes Expo, so **each instance talks to APNs
and to browser push services directly. No relay and no hosted push service sits
between them.** T3 needed a relay only because a laptop can't hold APNs keys
(remote-mobile.md §1, "The relay"). A self-hosted openchat server can.

## 1. Recommendation

| Decision | Choice | Why |
|---|---|---|
| APNs transport | **Our own adapter on `node:http2` and `node:crypto`**, with no new dependency. It's about 120 lines: one long-lived session, an ES256 JWT cached for 20 to 50 minutes, and one POST per notification. | The protocol is small (§2). The candidate libraries either reach into undici internals (`apns2`) or carry legacy weight (`@parse/node-apn`: `node-forge`, `verror`, certificate auth). Production runs on Node 24 (`apps/web/Dockerfile`: `node:24-bookworm-slim`, `next start`), so `node:http2` is fully available. |
| Fallback if we'd rather not own it | `@parse/node-apn` 8.1.0 (MIT, released 2026-04-12, `node:http2`, supports Live Activities and broadcast channels). | It's the maintained fork of the original `node-apn`, which was last released in 2017. |
| Web push | **The `web-push` npm package** 3.6.7 (MPL-2.0). It is the reference implementation of VAPID (RFC 8292) and `aes128gcm` encryption (RFC 8291). | Encryption is the fiddly part, and this package does it. It sends over `https.request`, so **MSW can intercept it** in tests. Its last release was January 2024, but the spec it implements hasn't changed. |
| Where sending happens | A **pg-boss job** (`notify.run`), enqueued from the run hooks. A `Notifier` port is passed into the job handler. | Retries and backoff come free. A slow APNs response never holds up a run settling. This matches how `afterRun` already enqueues `run.prune` and `title.generate` (`packages/server/src/services.ts:158`). |
| Payload content | **No chat content in the push.** Only ids plus generic localised text. The device's notification extension (iOS) or service worker (web) fetches the conversation title from the instance and rewrites the notification. | Chat text never passes through Apple's or Google's push services. This follows T3's "minimal payload" rule (remote-mobile.md §3.7) and Apple's advice not to put sensitive data in payloads (§2.4). |
| Foreground suppression | **On the client** in v1. iOS `willPresent` returns no options for the chat on screen. The web service worker skips a chat that already has a focused window. | It's cheap and exact. Doing it on the server would need stream-subscriber presence, which `StreamChannel` doesn't track (`packages/server/src/ports/stream-channel.ts`). |
| Live Activities | **Later.** The table and adapter below leave room for them (§5). | They need a widget extension and a `ContentState` contract first. |
| Electron desktop | Out of scope for now. Electron has no Push API service. It does have macOS-only `pushNotifications.registerForAPNSNotifications()` ([Electron docs][electron-push]). That would be another APNs `topic`, which is why the table stores `topic` on each row. |

## 2. APNs facts that shape the adapter

All of this is from Apple's documentation, read through its JSON sources
(`developer.apple.com/tutorials/data/documentation/usernotifications/*.json`)
because the HTML pages render client-side.

### 2.1 Connection and endpoints ([Sending notification requests][apns-send])

- HTTP/2 over TLS 1.2 or later.
  - Development: `api.sandbox.push.apple.com`.
  - Production: `api.push.apple.com`.
  - Port 443, or 2197 if a firewall needs it.
- `POST /3/device/<hex device token>`. "Don't make assumptions about device token size."
- Reuse a connection "for many hours to days". Send an HTTP/2 PING after about an hour idle. Resolve DNS (uncached) before each new connection.
- Concurrent streams vary. With token auth, APNs allows **one stream until the first request with a valid token succeeds**, so send one request before fanning out.
- APNs may close a connection with `GOAWAY` and a JSON `reason`. Reconnect on the next send.
- **Sandbox and production are separate hosts, and a token belongs to one of them.** A token sent to the wrong host gets `400 BadDeviceToken`. So every device row stores its environment.

### 2.2 Token auth ([Establishing a token-based connection][apns-token])

- JWT with header `{ alg: "ES256", kid: <10-char key id> }` and claims `{ iss: <10-char team id>, iat: <seconds> }`. Sign it with the `.p8` key.
- **Refresh no more than once every 20 minutes and no less than once every 60.** An older token gets `403 ExpiredProviderToken`. Refreshing too often on one connection gets `429 TooManyProviderTokenUpdates`.
- **Key scope changed.** New team-scoped keys "restrict usage to either Sandbox or Production". Existing keys that work in both environments "will continue to be supported". There can be at most two keys per environment.
  - Third-party setup guides (Airship, Mattermost) still describe a "Sandbox & Production" choice in the portal, so **ticket 186 should create a team-scoped key for Sandbox & Production if the portal offers it.**
  - If the key is limited to one environment, APNs answers the other environment with `403 BadEnvironmentKeyIdInToken`. The adapter should report that once as a configuration error, not as a device failure.
- One connection maps to one team. Unrelated key ids can't be mixed on one connection (`403 UnrelatedKeyIdInToken`).

Signing with `node:crypto` needs no library. Use `crypto.sign("sha256", data, { key, dsaEncoding: "ieee-p1363" })`, where `key` comes from `createPrivateKey(pem)`. The `ieee-p1363` option returns the raw `r||s` signature that JWS ES256 requires ([Node crypto][node-crypto]). `jose` is already in the lockfile through Better Auth if a library is preferred, but it isn't needed.

### 2.3 Request headers ([Sending notification requests][apns-send])

| Header | Our value |
|---|---|
| `authorization` | `bearer <jwt>` |
| `apns-push-type` | `alert` (later `liveactivity`). Must match the payload. |
| `apns-topic` | The bundle id, from `brand.appId` in `app.config.yaml` (already exists, for example `dev.openchat.app`). For Live Activities it's `<bundleId>.push-type.liveactivity`. |
| `apns-priority` | `10` for approvals and finished runs (the user should act). The default is also 10. |
| `apns-expiration` | Epoch seconds. `0` means try once and don't store. Use `now + 1 day` for "finished". For "approval needed", use however long the approval can wait (181 settles that). |
| `apns-collapse-id` | `run:<runId>` (40 bytes, within the 64-byte limit). An "approval needed" alert is then **replaced** by the later "finished" alert for the same run. |
| `apns-id` | A fresh UUID per send. Log it for debugging. |

The payload limit is **4096 bytes** (5120 for VoIP), with no compression. Ours stays well under 1 KB.

### 2.4 Payload keys ([Generating a remote notification][apns-payload])

The `aps` keys we use:

- `alert` as `{ title, body }`, or with `title-loc-key`/`loc-key` so the app's string catalog provides the text.
- `sound: "default"`.
- `thread-id`: the conversation id, which groups a chat's notifications.
- `category`: `RUN_FINISHED` or `RUN_APPROVAL`, which picks the action buttons.
- `mutable-content: 1`, which routes the notification through the app's Notification Service Extension.
- `interruption-level`: `active`. Use `time-sensitive` only with the entitlement, and it isn't needed in v1.
- `relevance-score`.

Our own keys sit next to `aps`, never inside it ("APNs ignores custom keys" in `aps`).

Apple says: "Don't include customer information or any sensitive data … If you must … encrypt it … You can use a notification service app extension to decrypt." That supports the no-chat-content rule in §1.

The **Notification Service Extension** ([Modifying content][apns-nse]) gets about **30 seconds** to rewrite a notification. If it runs out of time, `serviceExtensionTimeWillExpire` must return its best attempt. It runs only for notifications that show an alert.

### 2.5 Responses and token cleanup ([Handling notification responses][apns-resp])

- **200**: the body is empty.
- **410 `Unregistered` or `ExpiredToken`**: the token is dead. The body includes a `timestamp` (milliseconds) for when APNs confirmed the token was no longer valid. Delete the row only if it was last registered before that timestamp. A later re-registration means the token is valid again.
- **Never retry** `BadDeviceToken`, `DeviceTokenNotForTopic`, `Forbidden`, `ExpiredToken`, `Unregistered` or `PayloadTooLarge`.
  - Delete the row for `BadDeviceToken` and `DeviceTokenNotForTopic`. These usually mean the wrong environment or a stale token, and the app re-registers on its next launch anyway.
- **429 `TooManyRequests`**: retry with a delay.
- **5xx**: retry "after 15 minutes", with backoff.
- **403 `ExpiredProviderToken`**: sign a new JWT and retry once.
- **403 `InvalidProviderToken`, `BadEnvironmentKeyIdInToken` or `MissingProviderToken`**: a configuration error. Report it once and treat APNs as down for that environment.
- "APNs disconnects a provider connection with too many error conditions", and sooner on `BadDeviceToken`. A 410 isn't counted as an error. This is one more reason to delete bad tokens at once.

## 3. What the iOS app must implement

From Apple's [actionable notifications][apns-actions], [action options][apns-actopts] and [modifying content][apns-nse] docs, mapped to our flows.

1. **Entitlements.**
   - Add the Push Notifications capability. `aps-environment` is `development` for Xcode builds and `production` for TestFlight and the App Store.
   - The app reports which one it was built with when it registers. `#if DEBUG` means sandbox, otherwise production; that's the common heuristic and right for our build setups.
2. **Permission and registration.**
   - Call `requestAuthorization([.alert, .sound, .badge])` after an in-app explanation, not at first launch.
   - Call `registerForRemoteNotifications()` on **every launch**. Hex-encode the token in `didRegisterForRemoteNotificationsWithDeviceToken` and `PUT` it to the instance (§6). The server upserts, so repeating it is free and refreshes `lastSeenAt`.
3. **Categories at launch** (`setNotificationCategories`):
   - `RUN_FINISHED`: no buttons. Tapping opens the chat.
   - `RUN_APPROVAL`: `APPROVE` with option `.authenticationRequired` ("can be performed only on an unlocked device"), and `REJECT` with `.destructive` plus `.authenticationRequired`. Action identifiers must be unique across all categories.
4. **Handling taps and actions** in `userNotificationCenter(_:didReceive:withCompletionHandler:)`:
   - The default action deep-links to `conversationId` (and the run's branch).
   - `APPROVE`/`REJECT` call `POST /api/runs/{runId}/approvals` with the `toolCallId` from the payload (`submitApprovalsInputSchema`, `packages/contract/src/routes/runs.ts`).
     - The system launches the app in the background for this. Always call the completion handler.
     - A `CONFLICT` with reason `not_awaiting_approval` means someone else already decided. Post a local "already decided" notification, not an error.
   - **Product rule:**
     - Offer lock-screen approve/reject **only when exactly one tool call is pending and it has no proposed `edits`**.
     - With several calls or file edits, use `RUN_APPROVAL_REVIEW`, a category with no buttons, so the tap opens the app. Per-hunk review (D16) doesn't fit a lock screen.
     - The server picks the category, so this needs no app logic.
5. **Foreground.**
   - `userNotificationCenter(_:willPresent:)` returns `[]` when the user is viewing that conversation, and `[.banner, .sound]` otherwise.
   - Live UI should come from the run stream, not the push.
6. **Notification Service Extension** (a separate target).
   - On `mutable-content: 1`, read `conversationId` and fetch the title with the bearer token, then set `title`.
   - When it fails or times out, keep the generic text the server sent.
   - **The bearer token must live in a Keychain access group shared with the extension, with `kSecAttrAccessibleAfterFirstUnlock`**, because the extension runs while the phone is locked. This concerns ticket 190 (sign-in and Keychain), which should pick that accessibility class from the start.
7. **Sign-out and instance switch.**
   - `DELETE` the device on the server before discarding the bearer token.
   - Don't call `unregisterForRemoteNotifications()`. The same APNs token is reused for the next sign-in.
   - The session-cascade rule (§5) is the backstop if the app can't reach the server.
8. **Badge.** Not in v1. The server has no unread count to send.

## 4. Web push facts

- **Protocol** (RFC 8030 [§5.2–5.4][rfc8030]):
  - `TTL` is retention in seconds. `Urgency` is `very-low|low|normal|high`.
  - **`Topic`** is at most 32 URL-safe base64 characters, and "replaces any outstanding push message with an identical topic". It's the web's collapse id.
  - Use the run id without hyphens, base64url-encoded: 16 bytes become 22 characters.
  - RFC 8030 §7.3 signals an expired subscription with **404**. Push services also answer **410**, as Apple's does ("The device token has expired", [Apple web push][apple-webpush]). **Treat 404 and 410 as "delete the subscription".**
- **VAPID** (RFC 8292):
  - One P-256 key pair per instance. The browser subscribes with the public key as `applicationServerKey`.
  - Apple rejects a JWT whose `sub` isn't a `mailto:` or URL, whose `aud` isn't the push service origin, or whose `exp` is more than a day ahead. It also rejects a key that doesn't match the subscription (`VapidPkHashMismatch`).
  - `web-push` warns that Safari rejects a subject of `https://localhost` ([web-push README][web-push]).
  - **Rotating the VAPID key orphans every subscription**, so treat it as long-lived as `ENCRYPTION_KEY`.
- **Payload**: encrypted with `aes128gcm`, 4 KB maximum ([Apple web push][apple-webpush]).
- **Safari and iOS support:**
  - **macOS Safari 16 and later**: standard Web Push ([WebKit, Meet Web Push][webkit-push]).
  - **iOS and iPadOS 16.4 and later**: only for web apps **added to the Home Screen**, with a manifest whose `display` is `standalone` or `fullscreen`. Permission must be requested from a user gesture. Allow `*.push.apple.com` if you filter egress. No Apple Developer account is needed ([WebKit, Web Push for web apps on iOS][webkit-ios]).
  - **Declarative Web Push** shipped in iOS and iPadOS 18.4 and in Safari 18.5 on macOS ([WebKit][webkit-declarative], [Safari 18.5 notes][safari-185]).
    - It shows a notification from JSON (`"web_push": 8030`, `notification.title`, `navigate`) with no service worker.
    - We **don't need it**: our service worker has to fetch the title anyway (§1), and the classic service-worker path works on every browser.
    - It's worth knowing because it falls back cleanly: a declarative payload also goes to a service worker on older browsers.
- **Egress**: endpoints are whatever URL the browser returns (FCM, Mozilla autopush, `web.push.apple.com`). An instance with locked-down egress must allow those hosts. The same goes for `api.push.apple.com` for APNs.
- **The web app needs:**
  - a service worker with `push` and `notificationclick` handlers;
  - a manifest (already needed for an installable PWA);
  - a Settings toggle that calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` from a click.
  - The `push` handler checks `clients.matchAll({ type: "window" })` for a focused window on that chat and stays quiet if it finds one. Otherwise it fetches the title (same origin, cookie session) and calls `showNotification` with `tag: runId`, which replaces an earlier notification for the same run.
  - Chrome expects every push to show something when `userVisibleOnly` is set. Skip only when a focused client exists.
  - Web notifications have no lock-screen approve. The `actions` option exists in Chromium but not in Safari, so approvals open the chat.

## 5. Proposed data model (for 192, `packages/db`)

The table follows the house style: `idColumn`, `idRef`, `instant`, `createdAt()`/`updatedAt()` and a `oneOf` CHECK built from the contract's zod enums (`packages/db/src/schema/columns.ts`). It goes in a new `packages/db/src/schema/notifications.ts`.

```ts
export const PUSH_PLATFORMS = ["apns", "web"] as const;     // from pushPlatformSchema
export const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;

/**
 * Where a user's notifications go: one row per app install (APNs token) or
 * browser (web push subscription). Tied to the session that registered it, so
 * signing out or revoking that session stops its pushes.
 */
export const pushDevice = pgTable(
  "push_device",
  {
    id: idColumn("pushDevice"),
    userId: idRef("user_id", "user").notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Revoking the session (sign-out, Settings → Devices) drops the device. */
    sessionId: idRef("session_id", "session")
      .references(() => session.id, { onDelete: "cascade" }),
    platform: text("platform").$type<PushPlatform>().notNull(),
    /** APNs: the hex device token. Web: the subscription endpoint URL. */
    token: text("token").notNull(),
    /** APNs only: which host the token belongs to. */
    environment: text("environment").$type<ApnsEnvironment>(),
    /** APNs only: the bundle id it registered under (`apns-topic`). */
    topic: text("topic"),
    /** Web only: the subscription's `p256dh` and `auth` (base64url). */
    webKeys: jsonb("web_keys").$type<{ p256dh: string; auth: string }>(),
    /** "iPhone", "Firefox on macOS": what Settings shows. No authority. */
    label: text("label").notNull().default(""),
    /** Last (re)registration: compared against APNs' 410 `timestamp`. */
    registeredAt: instant("registered_at").notNull().defaultNow(),
    lastSentAt: instant("last_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("push_device_platform_token_idx").on(t.platform, t.token),
    index("push_device_user_idx").on(t.userId),
    check("push_device_platform", oneOf(t.platform, PUSH_PLATFORMS)),
    check("push_device_apns_fields", sql`${t.platform} <> 'apns' or (${t.environment} is not null and ${t.topic} is not null)`),
    check("push_device_web_fields", sql`${t.platform} <> 'web' or ${t.webKeys} is not null`),
  ]
);
```

Notes:

- **Instance scope is implicit.** One database is one instance. A phone signed into two instances has a row in each, and each instance pushes only for its own runs. No `instanceId` column is needed.
- **Unique on `(platform, token)`, and re-registration upserts.**
  - If the token arrives under a different user, the row moves to that user, because the phone changed accounts.
  - That stops a previous user's notifications from reaching a phone someone else now uses.
- **Revocation:**
  - Delete the row on APNs 410, `BadDeviceToken` or `DeviceTokenNotForTopic`, but only when `registeredAt` is before the 410 `timestamp`.
  - Delete it on web push 404 or 410.
  - Delete it on `DELETE /me/push-devices/{id}`.
  - Deleting the session cascades to the row. Better Auth keeps one session row across refreshes (`expiresAt` is updated in place), so the cascade happens only on real sign-out, revocation or expiry. After any of those, the app's next launch re-registers.
- **Not sealed.** A device token or endpoint only lets you send to an app or subscription with the instance's own keys. `webKeys` is encryption material for payloads we keep content-free. `ENCRYPTION_KEY` sealing is optional and would add little.
- **Preferences** don't need a table. Add `notifications` to `userSettingsSchema` and the `user_settings` row as a jsonb column: `{ runFinished: true, runFailed: true, approvalNeeded: true }`. They're read through the existing `/me/settings` routes.
- **Live Activities later:**
  - A `run_live_activity` table (`runId`, `deviceId`, `token`, `registeredAt`) for per-activity update tokens. These change during an activity and the old one must be invalidated ([ActivityKit push][la-push]).
  - A nullable `push_to_start_token` on `push_device` (iOS 17.2 and later).
  - Headers: `apns-push-type: liveactivity`, topic `<bundleId>.push-type.liveactivity`, `aps.event` of `start`, `update` or `end`, `aps.content-state` and `aps.timestamp`.
  - **Gotcha:** the system decodes `content-state` with the default `JSONDecoder` ("don't use any custom JSON encoding strategies"). Keys are camelCase, and a `Date` decodes from seconds since 2001, not the Unix epoch. Send numbers, not `Date`s.
  - Updates have an hourly budget. Priority 5 doesn't count against it, so use 5 for progress and 10 for finished or approval.

## 6. Proposed contract (input to 191, its own PR)

Routes go in `packages/contract/src/routes/account.ts` next to `me`. Schemas go in a new `packages/contract/src/schemas/notifications.ts`, plus a `pushDeviceIdSchema = idSchema("pushDevice")` in `common.ts`.

```ts
export const pushPlatformSchema = z.enum(["apns", "web"]);
export const apnsEnvironmentSchema = z.enum(["sandbox", "production"]);

export const registerPushDeviceInputSchema = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("apns"),
    token: z.string().regex(/^[0-9a-f]+$/i).min(32).max(400), // no fixed size (Apple)
    environment: apnsEnvironmentSchema,
    topic: z.string().min(1).max(255),   // server checks it equals brand.appId
    label: z.string().max(100).default(""),
  }),
  z.object({
    platform: z.literal("web"),
    subscription: z.object({            // PushSubscription.toJSON()
      endpoint: z.url().max(2048),
      expirationTime: z.number().nullable().optional(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
    }),
    label: z.string().max(100).default(""),
  }),
]);

export const pushDeviceSchema = z.object({
  id: pushDeviceIdSchema,
  platform: pushPlatformSchema,
  environment: apnsEnvironmentSchema.nullable(),
  label: z.string(),
  current: z.boolean(),                 // registered by the calling session
  registeredAt: timestampSchema,
  lastSentAt: timestampSchema.nullable(),
}); // never returns the token or endpoint

export const notificationPreferencesSchema = z.object({
  runFinished: z.boolean().default(true),
  runFailed: z.boolean().default(true),
  approvalNeeded: z.boolean().default(true),
});
// userSettingsSchema gains: notifications: notificationPreferencesSchema.default({})
```

| Route | Method and path | Errors | Notes |
|---|---|---|---|
| `pushDevices.register` | `PUT /me/push-devices` | `featureError` when that platform's push is off | Upserts on `(platform, token)` and binds to the calling session. Returns `pushDeviceSchema`. Idempotent, so it's called on every launch. |
| `pushDevices.list` | `GET /me/push-devices` | | For Settings → Devices. |
| `pushDevices.remove` | `DELETE /me/push-devices/{deviceId}` | not found | Used on sign-out and from Settings. Only your own devices. |
| `pushDevices.test` | `POST /me/push-devices/{deviceId}/test` | `featureError`, provider error | Sends "Notifications work". Invaluable while setting up a key. |
| (existing) `me.updateSettings` | `PATCH /me/settings` | | Carries `notifications` preferences. |
| (existing) `meta.config` | `GET /config` | | `publicConfigSchema` gains `push: { apns: boolean, webPushPublicKey: string \| null }`. The VAPID public key is public by design. |

- **Capabilities.** Ticket 155's `capabilities` list gains `push.apns` and `push.web` when each is configured. Clients hide the toggle when a capability is missing, so they never call `register` and get an error.
- **Who needs it and what breaks.** The iOS app (190 onwards) and the web Settings toggle need it. It's purely additive: new routes and optional new fields, so nothing existing breaks.

### Notification payloads (server-internal, but the app parses them)

APNs:

```json
{
  "aps": {
    "alert": { "title": "Reply ready", "body": "Open the chat to see it." },
    "sound": "default",
    "thread-id": "<conversationId>",
    "category": "RUN_FINISHED",
    "mutable-content": 1
  },
  "v": 1,
  "kind": "run.succeeded",
  "runId": "<runId>",
  "conversationId": "<conversationId>",
  "toolCallId": "<only for RUN_APPROVAL with exactly one pending call>"
}
```

Web push: the same object minus `aps`, plus `title` and `body`, encrypted by `web-push` with `topic` and `urgency: "high"`. The `title` and `body` are generic strings rendered on the server in `user.locale` through Lingui, so nothing is hard-coded. The iOS app could use `loc-key` instead, but one server-rendered path serves both platforms and the extension replaces the title anyway. **Version the payload (`v`)**, because one App Store build talks to servers on many versions (remote-mobile.md §3.2).

## 7. Events that send

| Run event | Kind and category | Who | Hook today |
|---|---|---|---|
| `succeeded` | `run.succeeded` / `RUN_FINISHED` | `run.createdBy` | `onSettled` → `afterRun` (`services.ts:158`). Enqueue `notify.run` there. |
| `failed` | `run.failed` / `RUN_FINISHED` | `run.createdBy` | Same hook. |
| `cancelled` | none | | The user (or Stop) did it. A timeout cancel might deserve one later. |
| `awaiting_approval` | `run.awaiting_approval` / `RUN_APPROVAL` or `RUN_APPROVAL_REVIEW` | `run.createdBy` (v1). Later, every editor with a grant, since "any editor may decide" (`routes/runs.ts`). | **No hook exists.** `finishTerminal` returns early for non-terminal states, and `settle` skips it when `outcome.status === "awaiting_approval"` (`packages/server/src/runs/executor.ts:405–423, 638`). The executor needs an `onAwaitingApproval` dependency next to `onSettled`. 181 owns pinning the exact spot. |
| Later | `run.needs_input`, scheduled runs (Dots) | | Once those states exist. |

Rules:

- Respect `notifications` preferences.
- Collapse per run (`apns-collapse-id`, web `Topic`), so a run produces at most one visible notification.
- Never block or fail a run on push.
- Log `apns-id` and the response reason. Never log tokens.

## 8. Configuration and degrade-to-off

Env var names, confirming and fixing ticket 186's guesses. They're read through an `app.config.yaml` `push:` block with `${NAME}` references, like `providers:`, so a missing variable means "absent".

| Variable | Meaning |
|---|---|
| `APNS_TEAM_ID` | 10-character team id (JWT `iss`). |
| `APNS_KEY_ID` | 10-character key id (JWT `kid`). |
| `APNS_KEY_PATH` | Path to the `.p8` file, kept outside the repo. **Or** `APNS_KEY`: the PEM contents inline, for Docker and secret managers (`\n` escapes allowed). If both are set, `APNS_KEY` wins. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Base64url P-256 pair. `bun run setup` generates it with `webpush.generateVAPIDKeys()` and writes it to `.env` (`packages/setup/src/env-file.ts`). |
| `VAPID_SUBJECT` | `mailto:` or an `https:` URL. Defaults to `BETTER_AUTH_URL` when that's https and not localhost. Otherwise web push stays off with a warning, because Safari rejects `https://localhost` and Apple rejects other forms. |

The APNs topic is `brand.appId`, which already exists and follows the brand rule (D18). No `APNS_BUNDLE_ID` is needed. There's no `APNS_ENVIRONMENT` either: environment is per device.

Degrade-to-off behaviour (D-"boots with an empty `.env`"):

- **None set:** push is off.
  - `publicConfig.push = { apns: false, webPushPublicKey: null }` and no capabilities.
  - `register` returns `FEATURE_DISABLED`.
  - The `Notifier` is a no-op, and events are dropped without being enqueued.
  - Nothing else changes.
- **Partly set** (for example a team id without a key):
  - That transport is off, with **one boot warning naming the missing variables**.
  - The key file is unreadable, or the PEM doesn't parse as an EC P-256 key: same.
  - Never crash boot.
- **APNs configured, web not** (or the reverse): each is independent. `Notifier` is a list of adapters chosen per device `platform`.
- **Runtime configuration errors** (`InvalidProviderToken`, `BadEnvironmentKeyIdInToken`, a VAPID `BadJwtToken`):
  - Report once.
  - Mark that transport (or that APNs environment) unhealthy in `/health` details.
  - Keep the device rows: the fault is ours, not theirs.
- **Existing rows when push is turned off** stay, and resume when keys return.

## 9. Testing (for 192)

- **MSW can't see `node:http2`.** `@mswjs/interceptors` covers `http`/`https` `ClientRequest`, `fetch`/undici, XHR, WebSocket and raw `net`/`tls` sockets. HTTP/2 isn't listed ([interceptors README][msw-int]).
  - So the APNs adapter takes a tiny transport port, `(request) => Promise<{ status, headers, body }>`. The handler tests use an in-memory fake that scripts 200, 410 with a timestamp, 403 `ExpiredProviderToken` and `GOAWAY`.
  - One adapter test runs against a local cleartext `http2.createServer()` (h2c) with `http2.connect("http://127.0.0.1:<port>")`. That exercises framing, headers and JWT refresh with no TLS certificate and no network.
- **`web-push` goes through `https.request`**, so MSW handlers on the endpoint URL cover it. Generate a real subscription key pair in the test (`crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })`) so encryption actually runs.
- **The JWT signer is a pure function of the key and a clock.** Test it with an injected `now` and verify the result with `crypto.verify`.

## 10. Open questions

- **Approvals for shared chats.** Should every editor be notified, or only the run's creator? v1 notifies the creator. Widening it needs `effectiveGrants`, and could become noisy.
- **Approval waiting time.** How long can an approval wait before it fails (181)? That sets `apns-expiration` and the web `TTL` for `run.awaiting_approval`.
- **Lock-screen approval.** Even with `.authenticationRequired`, is approving a tool from the lock screen without seeing its input acceptable? The alternative is a Notification Content Extension that shows the tool name and input summary. That's more work but better; it could come after v1.

## Sources

- Apple, *Sending notification requests to APNs*: <https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns> [apns-send]
- Apple, *Establishing a token-based connection to APNs*: <https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns> [apns-token]
- Apple, *Handling notification responses from APNs*: <https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns> [apns-resp]
- Apple, *Generating a remote notification*: <https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification> [apns-payload]
- Apple, *Declaring your actionable notification types*: <https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types> [apns-actions]
- Apple, *UNNotificationActionOptions* (`authenticationRequired`): <https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions> [apns-actopts]
- Apple, *Modifying content in newly delivered notifications*: <https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications> [apns-nse]
- Apple, *Starting and updating Live Activities with ActivityKit push notifications*: <https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications> [la-push]
- Apple, *Sending web push notifications in web apps and browsers*: <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers> [apple-webpush]
- WebKit, *Meet Web Push* (Safari 16, macOS): <https://webkit.org/blog/12945/meet-web-push/> [webkit-push]
- WebKit, *Web Push for Web Apps on iOS and iPadOS* (16.4): <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/> [webkit-ios]
- WebKit, *Meet Declarative Web Push*: <https://webkit.org/blog/16535/meet-declarative-web-push/> [webkit-declarative]
- Apple, *Safari 18.5 release notes*: <https://developer.apple.com/documentation/safari-release-notes/safari-18_5-release-notes> [safari-185]
- RFC 8030 (Generic Event Delivery Using HTTP Push): <https://www.rfc-editor.org/rfc/rfc8030.html> [rfc8030]
- RFC 8291 (Message Encryption for Web Push): <https://www.rfc-editor.org/rfc/rfc8291.html>
- RFC 8292 (VAPID): <https://www.rfc-editor.org/rfc/rfc8292.html>
- `web-push` 3.6.7 README: <https://github.com/web-push-libs/web-push> [web-push]
- `apns2` 12.2.0 source (`dist/esm/apns.js`: undici `Pool` with `allowH2`, `fast-jwt`, pings through undici internals): <https://github.com/AndrewBarba/apns2>
- `@parse/node-apn` 8.1.0 (`lib/client.js`: `http2.connect`; README: Live Activities, channels): <https://github.com/parse-community/node-apn>
- npm registry metadata for `apns2`, `@parse/node-apn`, `apn`, `web-push` and `jose` (versions, dates, licences, dependencies), read 2026-10-20.
- Node.js `crypto.sign` (`dsaEncoding: "ieee-p1363"`): <https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback> [node-crypto]; `node:http2`: <https://nodejs.org/api/http2.html>
- `@mswjs/interceptors` README (which modules are intercepted): <https://github.com/mswjs/interceptors> [msw-int]
- Electron `pushNotifications`: <https://www.electronjs.org/docs/latest/api/push-notifications> [electron-push]
- Airship and Mattermost setup guides (the "Sandbox & Production" key option; secondary, used only for the portal UI): <https://www.airship.com/docs/guides/getting-started/messaging/configure-channels/>, <https://docs.mattermost.com/developers/contribute/more-info/mobile/push-notifications/ios>
- Repo:
  - `packages/server/src/runs/executor.ts` (settle, `finishTerminal`, `onSettled`)
  - `packages/server/src/runs/state.ts` (`RunState` union)
  - `packages/server/src/services.ts` (`afterRun` enqueues jobs)
  - `packages/server/src/ports/stream-channel.ts`
  - `packages/db/src/schema/{columns,auth,usage}.ts` (table conventions)
  - `packages/contract/src/routes/{account,runs}.ts`
  - `packages/contract/src/schemas/{meta,runs,message-parts}.ts`
  - `app.config.example.yaml` (`brand.appId`), `.env.example`
  - `.context/research/t3code/remote-mobile.md` §1 and §3.7

[apns-send]: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
[apns-token]: https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
[apns-resp]: https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
[apns-payload]: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
[apns-actions]: https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types
[apns-actopts]: https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions
[apns-nse]: https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications
[la-push]: https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
[apple-webpush]: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
[webkit-push]: https://webkit.org/blog/12945/meet-web-push/
[webkit-ios]: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
[webkit-declarative]: https://webkit.org/blog/16535/meet-declarative-web-push/
[safari-185]: https://developer.apple.com/documentation/safari-release-notes/safari-18_5-release-notes
[rfc8030]: https://www.rfc-editor.org/rfc/rfc8030.html
[web-push]: https://github.com/web-push-libs/web-push
[node-crypto]: https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback
[msw-int]: https://github.com/mswjs/interceptors
[electron-push]: https://www.electronjs.org/docs/latest/api/push-notifications

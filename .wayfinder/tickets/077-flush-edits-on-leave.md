---
id: "077"
title: "Don't lose an edit typed just before a reload or close"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["070"]
---

## Question

070 found that the Workspace editor autosaves 800 ms after typing stops, so a reload or tab close within that window
loses the edit. An untouched file also says "Saved", so the state is ambiguous.

## Done when

- **Flush on leave.** A pending edit is flushed on `pagehide`/`visibilitychange` (hidden). Use a keepalive request
  (`fetch(..., { keepalive: true })` through the existing client, if it allows, or a small dedicated path). If the
  page is unloading with unsaved changes the flush can't guarantee, warn with `beforeunload`.
- **Honest state.** The status shows "Unsaved" while dirty, "Saving…" only during a slow save (over about 1 s, per
  Connor's "a write that lands is not news"), and nothing (or a quiet "Saved") once saved. Only failures speak.
- **Tests.** A unit test for the flush and the state machine, and an e2e test: type, reload immediately, and the edit
  persists.
- Gate and e2e pass.

## Owns

`packages/chat-ui/src/workspace/**` (the editor save path only: `model/editor.ts`, `use-open-file.ts`), tests.

## Results

Branch `t/077-flush-edits-on-leave`, stacked on `t/070-workspace-simplify` (draft PR #64), not pushed; `status` stays `open`.

**Flush on leave** (`use-open-file.ts`). `pagehide` and `visibilitychange` → hidden save a pending edit at once, through the usual save path (same `ifMatch`, so Reload/Overwrite on `version_mismatch` is unchanged). Every save whose body fits `KEEPALIVE_MAX_BYTES` (48 KiB of JSON, leaving room in the browser's 64 KiB in-flight keepalive budget) goes out with `keepalive: true`, so both the flush and an idle save already in flight land after the page is gone. `beforeunload` asks the browser to warn only when `safeToLeave` (pure, `model/editor.ts`) says the edits can't outlive the page: a draft too big for keepalive, typing during a save (it can't go before the save in flight says which version it made), or edits held by a conflict. The hook's `latest` ref now moves with each event rather than each render, so `visibilitychange` then `pagehide` back to back send one save, not two.

**Keepalive through the client.** The shared oRPC client (`packages/client`) can't set `fetch` options per call, so the port's `WorkspaceWriteInput` gained `keepalive?: boolean` and `apps/web/app/(app)/_shared/sandbox-client.ts` (outside Owns, as the brief allowed) sends those writes through a second `createApiClient` whose `fetch` adds `keepalive: true`, made on the first keepalive save. Same route, same body, same error decoding; no new routes, `packages/contract` untouched. The demo's just-bash client ignores the flag.

**Honest state** (`file-view.tsx`, `model/editor.ts`). An untouched or saved file says nothing. Typing says "Unsaved" (was "Unsaved changes"), which stays through a quick save; `SaveState.saving` has `slow`, set by a `save-slow` event `SLOW_SAVE_MS` (1 s) into the save in flight (typing during it doesn't restart the clock), and only then does it say "Saving…". Failures still speak: "Not saved" with the Reload/Overwrite alert, "Couldn't save" with the message.

**Tests.** `model/editor.test.ts`: the slow-save event (only for the save in flight, settles on landing), `fitsKeepalive` (escapes counted), `safeToLeave` (safe cases, and the three warn cases). `workspace-panel.test.tsx`: `pagehide` sends a pending edit at once with `keepalive`, a second event doesn't resend, `visibilitychange` → hidden does the same over the new version; a held save shows "Unsaved", then "Saving…" after 1 s, and `beforeunload` is prevented only once typing happened during it; the pause-save test now checks `keepalive` and that an untouched and a saved file say nothing. chat-ui 256/256. e2e: `workspace.spec`'s "survives a reload" drops 070's wait for the write: it types, sees "Unsaved", reloads at once, then checks the file through the API and by reopening it (and that the saved file shows no status). That spec 5/5 runs green on fresh servers (the test 1.4–4.2 s).

**Checks.** `gate.sh`: 82/82 (the first run had a library-ui test fail under load; it passed alone, then the gate passed clean). `E2E_PORT=3583 bun turbo test:e2e`: 37/37.

**Outside Owns:** `apps/web/app/(app)/_shared/sandbox-client.ts` (keepalive writes, allowed above); `packages/i18n/locales/en/messages.po` (extract).

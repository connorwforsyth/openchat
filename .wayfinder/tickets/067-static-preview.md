---
id: "067"
title: "Static pages preview without a server"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

For 066's built-in browser, static HTML should preview without the agent starting `npx serve`. There are no contract
changes: the server records a preview the same way the `preview` tool does.

## Done when

- **`ensureStaticPreview(workspace)`** (in `packages/sandbox`) works in workspaces whose provider has ports (Docker):
  - It starts a tiny built-in static file server inside the sandbox on a reserved port (e.g. 4173), serving `/work`:
    Node's `http` module only, correct MIME types, `index.html` for directories, no directory traversal, bound to
    0.0.0.0, started in the background (nohup), idempotent if it's already listening (reuse 063's listener probe).
  - It then exposes the port (`exposePort`) and records the preview (`recordPreview`) so it appears in `sandbox.get`.
  - The server script ships with the sandbox package and is written into the sandbox (e.g. `/home/sandbox/.static-preview.mjs`), not `/work`.
- **Called:**
  - after an agent `write`/`edit` of an `.html` file that was applied;
  - after a user `writeFile`/`importFile` of an `.html` file (059's handlers).
  - Best effort: a failure never fails the write, and is logged.
- **Stops cleanly:** the reserved port doesn't clash with the agent's own servers. If the agent later previews its
  own server, both previews are listed. The idle stop and snapshot/restore behave as before.
- **Agent instructions** (`WORKSPACE_INSTRUCTIONS` / tool descriptions): static HTML/CSS/JS previews automatically,
  so there's no need to start a server for it. Use `preview` for dev servers (Vite etc.).
- **Tests:** unit tests with fake exec/expose (start, idempotent, non-HTML ignored, failure tolerated), and the
  sandbox-runner smoke gains a step: write `index.html` and the static preview URL returns it. Gate passes.

## Owns

`packages/sandbox/src/**` (new `static-preview.ts`; hooks in `tools/tools.ts`, `handlers/turn-tools.ts`,
`handlers/workspace-files.ts`), `packages/server/src/runs/sandbox.ts` (instructions only),
`apps/sandbox-runner/test/e2e/smoke.ts`.

## Results

Branch `t/067-static-preview`, not pushed.

- **`ensureStaticPreview(sandbox)`** (`packages/sandbox/src/tools/static-preview.ts`; under `tools/` because
  `./tools/*` is already a package export, so the smoke imports it without a `package.json` change):
  - Docker only (`provider === "docker"`); anything else, just-bash included, returns `ok(null)` and runs nothing.
  - Probes `STATIC_PREVIEW_PORT` once with 063's listener probe, now in `tools/listener.ts` (`waitForListener`,
    shared with `preview`). If nothing listens, it writes the server to `/home/sandbox/.static-preview.mjs` ($HOME
    is tmpfs, so the script never shows in Files, snapshots or downloads), starts
    `nohup node … /work 4747 > ~/.static-preview.log 2>&1 < /dev/null &`, and waits up to ~5 s for the listener.
    It then calls `exposePort` and returns `{ port, url }`. A listener already on the port means no restart.
  - **Port: `STATIC_PREVIEW_PORT = 4747`**, not 4173: that's `vite preview`'s default, and the agent may want it.
    The `preview` tool description tells the agent the port is taken.
- **Server** (`tools/static-preview-server.ts`, a string written into the sandbox): Node built-ins only.
  - GET/HEAD only (405 otherwise); MIME types for web assets, `application/octet-stream` otherwise; `no-store`
    and `nosniff`.
  - A directory redirects to its trailing slash (leading slashes collapsed, so no `//host` redirect), then serves
    `index.html`, or 404.
  - Paths are decoded, joined and checked against the root, then `realpath`'d and checked again, so `..`, `%2e%2e`,
    encoded slashes and symlinks out of `/work` are all 404. Bad encoding or NUL is 400.
  - Binds 0.0.0.0. A second copy that hits `EADDRINUSE` exits 0, so racing starts are harmless.
- **Hooks** (best effort: failures are logged via an optional `log` dep, which defaults to `console.warn`, and
  never fail the write):
  - Agent: `createSandboxTools` takes `onChanged(path)`, called after a `write`/`edit` whose hunks were (partly)
    applied. It isn't called for unchanged, rejected or failed changes. `createTurnSandboxSource` wires it to
    `previewStaticPage` on the live sandbox (`lazySandbox.current()`) and records through `recordPreview`.
  - User: `writeWorkspaceFile` and `importWorkspaceFile` call it after a successful `put`.
  - Only `.html`/`.htm` paths trigger it.
- **Previews after a runner restart** (the coordinator's added requirement). The runner keeps exposures in memory,
  so recorded previews answered 404 after it restarted.
  - `ProviderEntry.restorePreviews` (`preview-restore.ts`; set for Docker in `sandboxProvidersFromConfig`)
    re-exposes a row's recorded ports. It runs at most once per sandbox per minute per process, because `exposePort`
    counts as runner activity and starts a stopped container.
  - For the static port it runs `ensureStaticPreview`, so a server that died in an idle stop comes back. The agent's
    own servers are only re-exposed.
  - It's called from `ensureWorkspace` (attach of a ready/stopped row) and from `getConversationSandbox`, only when
    the provider reports `ready`, so a panel read never wakes a stopped sandbox. If a re-exposed URL changed (say,
    a new preview template), the row is updated. just-bash has no restorer.
- **Instructions:** `WORKSPACE_INSTRUCTIONS` now says a static page shows in Preview once the `.html` is written,
  with no server, and that apps needing a dev server should use `preview` bound to 0.0.0.0. The `write`/`edit`
  descriptions say the same; `preview` says it's for dev servers and that 4747 is taken.
- **Tests** (sandbox package: 102 → 127):
  - `tools/static-preview.test.ts`, with a Docker-like fake (`src/testing/docker-like.ts`): start, idempotent,
    restart after a stop, just-bash/memory no-op, and "didn't come up" with nothing exposed. `previewStaticPage`:
    non-HTML ignored, records a page, and logs both an expose failure and a throwing `record`. The real server
    script is spawned with Node on a temp dir: types, no-store, index.html and redirect, traversal/encoded/symlink
    refused, 400s, HEAD/405, and a second copy exiting 0.
  - `tools.test.ts`: `onChanged` only for landed changes; the description text.
  - `turn-tools.test.ts`: an agent write of `index.html` records the 4747 preview, CSS doesn't start anything,
    an edit doesn't restart it, a failing expose keeps the write, and `ensureWorkspace` re-exposes and restarts
    after a runner restart plus idle stop.
  - `workspace-files.test.ts`: saving or importing `.html` records the preview (one server), a failure keeps the
    save and is logged, and just-bash does nothing.
  - `sandbox.test.ts`: `get` re-exposes forgotten ports at most once a minute, leaves a stopped sandbox alone,
    brings back the static server and fixes a moved URL, and just-bash is a no-op.
- **Docker smoke:** a new "static preview" step in `apps/sandbox-runner/test/e2e/smoke.ts` writes `site/index.html`
  and `style.css`, then calls the real `ensureStaticPreview`. Through the preview proxy, `/site/` returns the page
  and the CSS comes back as `text/css`; `/%2e%2e/etc/passwd` is 404. A second call reuses the server (exactly one
  process in `/proc`), and nothing lands in `/work`.
  - Ran it on compose project `t067` (ports 7170/7171, `--no-build` on the existing `openchat-sandbox-runner`
    image, since the runner code is unchanged here; override file for container name, preview URL and a huge idle
    timeout so it couldn't reap other runners' sandboxes), with `EXPECT_RUNTIME=runc`: **passed**.
  - A throwaway script (deleted) confirmed the restore on the real runner: static preview 200, `docker restart` of
    the runner then 404, restorer then 200.
  - `down -v` done; none of my sandboxes, volumes or networks remain.
- **For 066:** the static preview is the row's preview with `port === 4747` (`STATIC_PREVIEW_PORT`, importable
  from `@workspace/sandbox/tools/static-preview`). A file at `/work/<p>` is at `<url>/<p>`.
- **Left:**
  - The agent can still make HTML with `bash` (`cat > index.html`), which doesn't trigger the hook; the
    instructions steer it to `write`.
  - A directory without `index.html` is a 404, not a listing.
  - The static server isn't restarted after an idle stop until the next `.html` write, attach or read of the
    running sandbox (at most a minute's throttle).
- **Gate:** passes (82/82). The first run failed `@workspace/db#test` (not touched here) at load average ~150; it
  passed alone (68/68), and the rerun passed in full.

## Resolution (2026-09-30, loop)

Merged in [PR #57](https://github.com/connorwforsyth/openchat/pull/57). Static server on `STATIC_PREVIEW_PORT = 4747`, started on `.html` writes (agent and user); `restorePreviews` re-exposes recorded previews after a runner restart. Sandbox tests 127, runner smoke passed, gate 82/82. Left: HTML created through `bash` doesn't trigger it; a folder without `index.html` returns 404.

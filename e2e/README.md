# End-to-end tests

Playwright over the production build of `apps/web` (PLAN.md §11 M1).

```sh
bun turbo test:e2e      # builds apps/web, then runs the suite
```

`e2e/support/serve.ts` is Playwright's web server: `next start` on an
otherwise empty environment, so the app boots on the embedded database
(PGlite) in a fresh temporary directory, deleted afterwards. Every run starts
from a server with no users. It sets only what production refuses to run
without (a generated `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY`) and an
`app.config.yaml` whose providers point at `support/mock-llm.ts`, an
OpenAI-compatible mock model server. The app reaches it through its ordinary
`openai-compatible` provider, like Ollama; no real provider is ever called.
The mock's replies are steered by the message (see the comment at its top):
`[slow]` streams slowly, `[tool:<name> <json>]` calls a tool, `remember …`
calls `update_memory`, `[search:…]` calls `file_search`, `[script:<name>]`
plays a scripted multi-step turn (`SCRIPTS`, a step may call several tools;
`harness.spec.ts` drives approvals, Stop and reloads with them), anything
else echoes.
The echo ends with each workspace file the turn read in (an `@` mention or an
attachment) as `[path: content]`, so a spec can see what reached the model.

`accounts.setup.ts` runs first: the first sign-up (the admin), an org made
from the account menu with a team tree, and two more people joining by the
invite links the members page shows. The specs build on the browser state and
ids it saves in `e2e/.auth/` (gitignored). One worker, in file order, against
one server. Specs drive the UI; the typed API client (`support/api.ts`) only
reads back what the UI implies and sets up what isn't this suite's subject
(publishing an agent, granting access, a team key).

The server trusts loopback as its proxy (`TRUSTED_PROXIES`), so a request
that carries `X-Forwarded-For` reads as a client behind a proxy
(`proxy.spec.ts`: sign-in rate limits per client address).

The server's `BETTER_AUTH_URL` is `http://localhost:<port>`. `shell.spec.ts`
also signs in at `http://127.0.0.1:<port>` (loopback names stand in for each
other) and checks the refusal at `http://e2e.localhost:<port>`, which Chromium
sends to this machine but the server doesn't trust (054).

The D27 timings (TTFB, `composer:ready`, first token) are recorded as the
suite goes and printed at the end.

- `E2E_PORT` picks the port (3100).
- `E2E_STANDALONE=1` runs the server the Docker image runs: after
  `NEXT_OUTPUT=standalone bunx next build` in `apps/web`, the standalone
  output is laid out as `apps/web/Dockerfile` lays it out (static assets,
  migrations) and started with `node server.js`. It checks the image's
  contents without Docker.
- `E2E_DEV=1` runs `next dev` instead, to debug a failure with React's
  development warnings (slow: it compiles on demand). `workspace.spec.ts`
  under it is also the check that a just-bash command can't take `next dev`
  down (076): `E2E_DEV=1 bunx playwright test e2e/tests/workspace.spec.ts`.

## Docker

Run when Docker is available (it isn't needed for the suite above):

```sh
docker compose -p smoke up -d --build --wait
E2E_BASE_URL=http://localhost:3000 bun e2e/support/compose-smoke.ts
docker compose -p smoke down -v
```

`compose-smoke.ts` checks the image on Postgres: boot and migrations, the
first sign-up as admin, a stored chat, a signed-in page. CI runs it on pushes
to `main` (`e2e` job). See `docs/self-hosting.md`.

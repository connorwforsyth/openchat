# Self-hosting

The app runs as one `web` container (Next.js with the API at `/api`, on
Node 24) next to Postgres 17 with pgvector (PLAN.md D6). Docker Compose
brings up both.

## Quick start

```sh
cp .env.example .env
docker compose up -d
```

Open <http://localhost:3000> and create an account: **the first account
becomes the administrator**, and after that people join by invitation
(Admin › Members).

What happens on the first start:

- The `web` image builds from the repo (a few minutes the first time).
- `web` waits for Postgres to be healthy, then applies the database
  migrations itself (under a lock, so several replicas migrate once).
- `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` are required in production. If
  `.env` leaves them empty, `web` generates them once and keeps them in its
  data volume (`web-data`, file `.secrets.env`). To manage them yourself, set
  both in `.env` (`openssl rand -base64 32` each) before the first start.
  Losing `ENCRYPTION_KEY` makes stored provider keys unreadable.

Everything else in `.env` is optional; a missing value turns its feature off
rather than failing the start. Models come from `app.config.yaml` (copy
`app.config.example.yaml`); with none, the app looks for a local Ollama.

`web` listens on `127.0.0.1:3000` only. To serve it to a network, put a TLS
proxy (Caddy, nginx, Traefik) in front and set `BETTER_AUTH_URL` to the
public origin.

### Configuration file

To use an `app.config.yaml`, mount it and point `CONFIG_PATH` at it, in a
`docker-compose.override.yml`:

```yaml
services:
  web:
    environment:
      CONFIG_PATH: /config/app.config.yaml
    volumes:
      - ./app.config.yaml:/config/app.config.yaml:ro
```

An invalid file doesn't half-start: the API answers with the list of
problems, and so does the log.

## Optional services

Each is a compose profile; start it alongside the rest.

| Profile | Starts | Also set in `.env` |
|---|---|---|
| `search` | SearXNG, for the `web_search` tool | `SEARXNG_URL` (any value; inside compose `web` uses `http://searxng:8080`) |
| `sandbox` | `sandbox-runner` and a Docker socket proxy, for Docker sandboxes | `SANDBOX_RUNNER_TOKEN`, and `sandbox.docker` in `app.config.yaml` |
| `artifacts` | The artifact runtime, on its own origin | `ARTIFACTS_ORIGIN`, `ARTIFACTS_APP_ORIGINS` |

```sh
docker compose --profile search --profile sandbox up -d
```

`web` never mounts the Docker socket; only `sandbox-runner` reaches Docker,
through the proxy, on an internal network (D24). Without the `sandbox`
profile, chats still get just-bash sandboxes, which run in-process and need
no Docker.

## Updating

```sh
git pull
docker compose up -d --build
```

Migrations run on start. `docker compose logs -f web` shows them.

## Backups

Back up the Postgres database and the `web-data` volume (uploaded files and
the generated secrets):

```sh
docker compose exec postgres pg_dump -U postgres app > backup.sql
docker run --rm -v "$(basename "$PWD")_web-data:/data" -v "$PWD:/backup" \
  node:24-bookworm-slim tar czf /backup/web-data.tgz -C /data .
```

## Checking a deployment

`bun e2e/support/compose-smoke.ts` (with the stack running) signs a first
user up on a fresh database, checks the session and the API against Postgres,
and cleans up nothing, so point it at a throwaway stack:

```sh
docker compose -p smoke up -d --build --wait
E2E_BASE_URL=http://localhost:3000 bun e2e/support/compose-smoke.ts
docker compose -p smoke down -v
```

CI runs the same on pushes to `main` (`.github/workflows/ci.yml`, `e2e` job).
The full end-to-end suite (`bun turbo test:e2e`) runs against the production
build on the embedded database and doesn't need Docker.

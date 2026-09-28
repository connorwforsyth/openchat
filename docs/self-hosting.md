# Self-hosting

The app runs as one `web` container (Next.js with the API at `/api`, on
Node 24) next to Postgres 17 with pgvector (PLAN.md D6). Docker Compose
brings up both.

## Quick start

```sh
bun install
bun run setup          # asks a few questions, writes the config files
bun run setup up       # builds and starts it, and prints the URL
```

Open <http://localhost:3000> and create an account: **the first account
becomes the administrator**, and after that people join by invitation
(Admin › Members).

`bun run setup` asks how to run the app (Docker, or `bun dev` for working on
the code), which model providers to use and their keys, who can sign up,
the instance name, sandboxes, optional services and the icon set. Every
question has a safe default. It writes:

- `.env`: keys (typed into a masked prompt; they're written here and nowhere
  else), the sandbox runner's token, service URLs and the icon build args.
  Readable by you only.
- `app.config.yaml`: providers (as `${ENV}` references), models, sign-up,
  sandboxes, search and icons. It's checked against the app's schema before
  anything is written.
- `docker-compose.override.yml` (Docker only): mounts the config into `web`
  (see [Configuration file](#configuration-file)).

Run it again to change anything: it starts from what the files say now,
edits them in place (comments and your own additions stay) and asks before
overwriting each one. `bun run setup doctor` checks Docker, ports, the
config, `/api/health?ready=true`, the sandbox runner and that a model
answers, and says how to fix each failure. `app.config.yaml` and
`docker-compose.override.yml` are gitignored, like `.env`.

In local mode, `bun run setup up` starts what `bun dev` needs in Docker
(Postgres unless you chose PGlite, the sandbox runner, SearXNG), then runs
`bun dev` with `.env` and `app.config.yaml` handed to it.

The same by hand, with every setting at its default:

```sh
cp .env.example .env
docker compose up -d
```

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

### Behind a proxy

Sign-in and sign-up are rate limited per client address, and each session
records the address it signed in from. Behind a proxy, the app sees the
proxy's address, and the client's arrives in `X-Forwarded-For`, a list each
proxy appends to and any client can start. So the app reads it from the
right and believes an entry only when every hop after it is a proxy you
trust. List yours in `TRUSTED_PROXIES`, as addresses or CIDR ranges:

```sh
# a proxy on the same host, or on a Docker network
TRUSTED_PROXIES=127.0.0.1, ::1, 172.16.0.0/12
```

- Unset, only the last entry counts: the address the nearest proxy saw.
  That's right for exactly one proxy that appends the client's address
  (nginx `$proxy_add_x_forwarded_for`, Caddy, Traefik).
- With two hops (a CDN, then your proxy), list the inner ones, or every
  sign-in lands in the proxy's bucket and people lock each other out.
- Don't list ranges that clients can send from: their own entries would
  then be believed, and they could pick their rate-limit bucket.
- Without any proxy, Next.js fills the header with the connection's address
  when the request has none, but keeps one a client sent. Serve the app
  through a proxy that overwrites or appends to the header.

Entries that aren't an address or a range are ignored, with a warning at
start.

### Configuration file

To use an `app.config.yaml`, mount it and point `CONFIG_PATH` at it, in a
`docker-compose.override.yml` (`bun run setup` writes this for you):

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

### Uploaded files

Uploads go to the local file store, `storage.path` in `app.config.yaml`
(default `./.data/files`, relative to `apps/web`). In the image `./.data`
links into the `web-data` volume, so with the default, or any relative path
under `./.data` or `./data`, uploads survive `web` being recreated. Anywhere
else needs a volume of its own. For S3-compatible storage (S3, R2, MinIO),
see the `storage` block in `app.config.example.yaml`.

### Icon set

The icon set is compiled into the image, so the `icons` block of a mounted
`app.config.yaml` can't change it: the image is built before the file is
there. Choose the set with build args instead, in `.env` (compose passes them
through):

```sh
ICON_SET=material        # lucide (default), phosphor or material
ICON_STYLE=rounded       # Material only: outlined (default), rounded, sharp
ICON_WEIGHT=400          # Material only: 100–700, default 400
ICON_FILL=false          # Material only: true for the filled symbols
```

then rebuild with `docker compose up -d --build`. Without compose, pass them
to `docker build` as `--build-arg ICON_SET=material` and so on. Outside
Docker, `bun run build` reads the `icons` block itself (from `CONFIG_PATH`, or
`apps/web/app.config.yaml`), and these variables override it.

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

Until the image linked `./.data` into the `web-data` volume, uploads at the
default path were kept in the container itself (`/app/apps/web/.data/files`)
and lost whenever it was recreated. If yours has some there (a
`storage.path` under `./data` was already in the volume), copy them out
before updating, and back in after:

```sh
docker compose cp web:/app/apps/web/.data/files ./files-backup  # before
git pull && docker compose up -d --build
docker compose cp ./files-backup/. web:/app/apps/web/data/files
docker compose exec -u root web chown -R node:node /app/apps/web/data/files
```

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

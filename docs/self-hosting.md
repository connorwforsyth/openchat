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

#### Addresses that can sign in

Sign-in and sign-up only work from the address in `BETTER_AUTH_URL`: the
server refuses them from any other origin, and the form says which address
to open instead. When `BETTER_AUTH_URL` is on `localhost`, `127.0.0.1` or
`[::1]`, the other two names on the same scheme and port work as well (the
default `http://localhost:3000` also answers at `http://127.0.0.1:3000`).

To serve the same instance under more than one name (a second domain, or a
LAN address while you try it out), list the others in `TRUSTED_ORIGINS`:

```sh
BETTER_AUTH_URL=https://chat.example.com
TRUSTED_ORIGINS=https://chat.example.org, http://192.168.1.20:3000
```

- Each entry is an exact origin: scheme, host and port. Paths, credentials
  and wildcards (`https://*.example.com`) are refused; refused entries are
  ignored, with a warning at start.
- Better Auth also reads its own `BETTER_AUTH_TRUSTED_ORIGINS`, unchecked and
  with wildcards. Use `TRUSTED_ORIGINS` instead; the app warns when the other
  is set.
- `bun run setup doctor` shows the address to open.

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

`limits.agentMaxSteps` (default 20) caps how many model calls one turn may
make: each round of tool calls is a step, and the agent is stopped when it
reaches the cap. Raise it for long tool-heavy work, lower it to bound what a
runaway turn can spend:

```yaml
limits:
  agentMaxSteps: 40
```

### Model prices and cost

The app ships **no prices**: they change, they differ by contract and
region, and a wrong built-in price would be worse than none. Until you set
them, every usage row is recorded with its token counts and a cost of 0.
To have Admin › Usage and budgets count money, list what your providers
charge you under `models.prices`:

```yaml
models:
  aliases:
    fast: openai:gpt-4.1-mini
  prices:
    # micro-USD per million tokens: dollars per million tokens × 1000000
    openai:gpt-4.1-mini:
      inputMicros: 400000          # $0.40 per million input tokens
      outputMicros: 1600000        # $1.60 per million output tokens
      cachedInputMicros: 100000    # $0.10 per million cached input tokens
    anthropic:claude-sonnet-4-5:
      inputMicros: 3000000         # $3.00
      outputMicros: 15000000       # $15.00
```

The numbers above only show the format. Take yours from your provider's
price list or your invoice; the app never looks prices up anywhere.

- **The key is the full `provider:modelId` ref**, the one an alias points
  to and the one Admin › Usage lists, not the alias. Its provider has to be
  under `providers`, so a misspelt provider fails at start. A misspelt model
  id can't be caught: that model just stays unpriced.
- **The unit** is whole micro-USD (1 USD = 1000000) per million tokens, the
  same unit as `costMicros` on usage rows and `limitMicros` on budgets. Write
  plain integers: `0.4`, `$0.40` and `400_000` are all refused. The app
  assumes US dollars throughout (the admin pages print `$`). If you are
  billed in another currency, convert the prices yourself, once; nothing
  converts at run time.
- **`cachedInputMicros` is optional.** Providers that report cache reads
  count them inside the input tokens; those tokens are charged at this price
  and the rest at `inputMicros`. Leave it out and cached tokens cost the same
  as any other input. Cache *writes* aren't reported apart from input, so a
  provider's surcharge for them isn't counted. Reasoning tokens are part of
  the output tokens and are charged once, at `outputMicros`.
- **Rounding:** `uncached input × inputMicros + cached input ×
  cachedInputMicros + output × outputMicros`, summed exactly, divided by
  1000000 and rounded half up to a whole micro-USD, once per recorded call
  (a chat turn with several tool steps is one call). It's integer arithmetic
  all the way, so totals never drift.
- **A model with no entry is unpriced**: its calls cost 0 and spend no
  budget. A usage row doesn't record whether its model had a price, so in
  Admin › Usage a model with tokens and `$0.00` is either unpriced or
  priced at 0 (as you might a local Ollama model, with `inputMicros: 0` and
  `outputMicros: 0`); check it against this block.
- **Prices apply from the restart that loads them.** Rows already recorded
  keep the cost they were written with (0, before you set any), and changing
  a price later doesn't re-cost history.
- The same price applies whoever's key paid for the call (the instance's, an
  org's or a person's own), and to chat turns, calls through `/api/llm` and
  eval runs alike.

> **Setting prices switches budgets on.** A budget (Admin › Usage) compares
> what its user, team or org has spent this day, week or month with its
> limit, and a *hard* budget refuses new runs (HTTP 402, "The budget for
> this period is spent") once spend reaches it. While every call cost 0,
> spend never moved, so a budget with a limit above 0 never refused anything.
> From the first priced call it does. Before you add prices, look over the
> budgets you already have: a limit that was entered as a placeholder will
> now be enforced. The check runs before a run starts, so the run that
> crosses the limit finishes and the next one is refused; unpriced models
> still add nothing, but are refused like any other once the budget is
> spent.
### Offering every model a provider serves

By default the model picker offers `auto`, your `models.aliases` and each
provider's `models` list, nothing else. To offer everything a provider
serves, turn on `discover` for it, and narrow the list with `include` and
`exclude`: whoever picks a model then decides what it costs.

```yaml
providers:
  # The Vercel AI Gateway, as an openai-compatible provider.
  gateway:
    type: openai-compatible
    baseURL: https://ai-gateway.vercel.sh/v1
    apiKey: ${AI_GATEWAY_API_KEY}   # an instance key; or leave it out and
    options: { keyless: "false" }   # let teams and users bring their own
    discover: true
    include: ["anthropic/*", "openai/gpt-5*", "google/gemini-2.5-*"]
    exclude: ["*-pro"]
    models: [openai/gpt-4.1]        # always offered, whatever the patterns say
    discoverTtlSeconds: 3600        # the default
  # A local Ollama: every model you've pulled, minus the embedding ones.
  ollama:
    type: openai-compatible
    baseURL: http://localhost:11434/v1
    discover: true
    exclude: ["*embed*"]
```

- **Where the list comes from.** An `openai-compatible` provider's
  `{baseURL}/models`; Ollama's `/api/tags` (for a provider named `ollama`,
  or any with `options: { catalog: ollama }`); and the list-models APIs of
  `anthropic`, `openai` and `google`. `azure` and `bedrock` have no catalog:
  list their `models` instead.
- **Whose key reads it.** The same key that would pay for a chat in that
  context (an instance key where the policy allows, or the team's, org's or
  user's), so a context never sees a catalog it couldn't use. Without a key,
  nothing is fetched and the provider's models show as unavailable, as before.
- **Patterns.** Globs over the model id: `*` matches anything (slashes
  included), `?` one character. A model is offered when it matches `include`
  (or `include` is empty) and doesn't match `exclude`. Models under `models`,
  alias targets, `models.default` and the `auto` ends are always offered.
- **Runs follow the same rule.** The server refuses a run whose model its
  provider's patterns or catalog leave out, not just the picker. `include`
  and `exclude` also apply to a provider without `discover`.
- **Caching and failures.** Each provider's catalog is cached per key for
  `discoverTtlSeconds` and fetched with a 5 second timeout. If it doesn't
  answer, that provider offers (and runs) only its configured models, the log
  says so once, and it's tried again a minute later.

### Model descriptions

The model picker's preview card says in one line why you'd pick a model.
Set them under `models.descriptions`, keyed by alias or by `provider:model`
ref:

```yaml
models:
  aliases:
    fast: anthropic:claude-haiku-4-5
    strong: anthropic:claude-opus-5-5
  descriptions:
    fast: Quick everyday answers
    strong: Hard problems and long documents
    gateway:openai/gpt-4.1: Steady at following instructions
```

- **Where a line comes from.** Your `models.descriptions` entry for the
  alias, then for the ref it points at, then the provider's catalog when
  `discover` is on and the catalog describes the model (OpenAI-compatible
  gateways and Google do; Anthropic, OpenAI and Ollama don't). Otherwise
  the card has no description. `auto` has its own line, in the app's language,
  and can't be given one here.
- **Length.** Only the first line is kept, and anything past 120 characters
  is cut at a word with an ellipsis.
- **Checked at boot.** A key that isn't an alias or a ref to a configured
  provider is a config error, like any other model reference.
- The picker's search matches descriptions too, and groups models by who
  makes them (`gateway:anthropic/…` sits under Anthropic).

### The model preview card

Highlight a model in the picker (arrow keys or the pointer) and a card beside
it shows what's known about it. Nothing on it is guessed: a fact nobody
supplied is left off.

- **Name.** The provider catalog's name (`Claude Opus 4`, without
  OpenRouter's `Anthropic: ` prefix), else one tidied from the model id
  (`claude-3-5-sonnet-20241022` is "Claude 3.5 Sonnet"). The vendor prefix is
  never shown; the vendor's logo and name sit beside the row instead.
- **Speed and intelligence** bars come only from your config, 1 (least) to 5
  (most), keyed by alias or `provider:model` ref. The alias's rating beats its
  ref's; a model without one shows no bar. Checked at boot like
  `descriptions`, and `auto` can't be rated.

  ```yaml
  models:
    ratings:
      fast: { speed: 5, intelligence: 3 }
      strong: { speed: 2, intelligence: 5 }
      gateway:openai/gpt-4.1: { intelligence: 4 }
  ```
- **Cost** comes from the catalog's prices when `discover` is on and the
  catalog lists them (the Vercel AI Gateway and OpenRouter do; Anthropic,
  OpenAI, Google and Ollama don't). The bar is a 1–5 tier of the blended
  price (three input tokens to one output): up to $0.50, $2.50, $8 and $20 per
  million tokens, then anything dearer.
- **Context** is the context window from the catalog, shown in tokens and
  roughly in words (three quarters of a token each).
- **Vision, Tool use and Reasoning** are the provider's capabilities
  (`options.capabilities` for an OpenAI-compatible server), less anything the
  catalog says the model lacks; Reasoning shows when the catalog says the
  model reasons (gateway tags, OpenRouter's parameters, Google's `thinking`).
  The card never claims vision the provider config doesn't send.

### Thinking levels and fast mode

Beside the model button, a thinking control sets how hard a reasoning model
thinks; Fast mode, in the composer's **+** menu, asks for a provider's fast
tier. Both are remembered per model for each person, and sent with each turn
as the run's `reasoning` and `fast` options (visible later on the run).

- **Which models.** The thinking control shows for a model the provider or
  its catalog says reasons. Its levels are the ones the provider takes:
  Anthropic off (except models that always think), low, medium, high, and
  extra high on Opus/Sonnet 4.6 and later; OpenAI low to high, off from
  GPT-5.1, minimal on GPT-5, extra high on GPT-6; Gemini 2.5 off (except
  2.5 Pro) to high, Gemini 3 minimal to high; others low to high. An
  OpenAI-compatible server gets a level only when `discover` is on and its
  catalog says the model reasons. A level a model doesn't take is dropped and
  the provider's default applies.
- **Catalog modes fold in.** A catalog entry that's only a mode of another
  listed model (`o4-mini-high`, `claude-3.7-sonnet:thinking`,
  `claude-opus-5-fast`, and the `-thinking`, `-reasoning`, `-highspeed`,
  `-ultraspeed`, `-instant` and `-turbo` suffixes) isn't listed separately: it becomes that model's
  thinking level or its Fast mode.
- **Fast mode** uses OpenAI's priority processing (`serviceTier: priority`,
  GPT-4 and later and o3 and later, not nano or chat models) or Anthropic's
  fast mode (`speed: fast`, Opus 4.6), or a catalog's `-fast` entry. **Both
  provider tiers are billed at a higher rate than standard requests**; check
  the provider's pricing before your users rely on it.

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

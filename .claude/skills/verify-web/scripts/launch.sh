#!/usr/bin/env bash
# Starts a disposable web app for verification: e2e/support/serve.ts on its own
# port, an embedded PGlite database in a fresh temp dir, and providers that
# point only at the mock model server. Waits until the app is usable, then
# prints the run directory. Usage:
#   .claude/skills/verify-web/scripts/launch.sh            # dev mode, port 3100
#   VERIFY_PORT=3111 VERIFY_MODE=prod .claude/skills/verify-web/scripts/launch.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PORT="${VERIFY_PORT:-3100}"
MODE="${VERIFY_MODE:-dev}"
RUN_ID="${VERIFY_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
BASE="$ROOT/.context/tmp/verify-web"
RUN_DIR="$BASE/$RUN_ID"
URL="http://localhost:$PORT"

if [[ "$PORT" == "3000" ]]; then
  echo "launch: refusing port 3000; the user's own instance lives there" >&2
  exit 2
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "launch: port $PORT is already in use; pick another VERIFY_PORT" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  exit 2
fi
if [[ -f "$BASE/active" ]] && [[ -f "$(cat "$BASE/active")/server.pid" ]] &&
  kill -0 "$(cat "$(cat "$BASE/active")/server.pid")" 2>/dev/null; then
  echo "launch: a verify-web instance is already running ($(cat "$BASE/active")); run cleanup.sh first" >&2
  exit 2
fi

mkdir -p "$RUN_DIR/evidence"

# Prerequisites. All outputs are gitignored build products.
[[ -d "$ROOT/node_modules" ]] || (cd "$ROOT" && bun install)
if [[ ! -f "$ROOT/apps/artifacts/dist/server.js" ]]; then
  echo "launch: building the artifact runtime (apps/artifacts/dist)"
  (cd "$ROOT/apps/artifacts" && bun run build >/dev/null 2>&1)
fi
# Generated sources turbo's `dev` and `build` depend on (fonts.selected.ts,
# icons selected.ts, compiled catalogs). Without them every page is a 500.
(cd "$ROOT" && env -u CONFIG_PATH bun turbo run i18n:compile icons:select fonts:select \
  --output-logs=errors-only >/dev/null)
case "$MODE" in
  dev) export E2E_DEV=1 ;;
  prod)
    if [[ ! -f "$ROOT/apps/web/.next/BUILD_ID" ]]; then
      echo "launch: no production build; running next build in apps/web"
      (cd "$ROOT/apps/web" && bunx next build)
    fi
    unset E2E_DEV
    ;;
  *) echo "launch: VERIFY_MODE must be dev or prod" >&2; exit 2 ;;
esac

echo "$PORT" > "$RUN_DIR/port"
echo "$MODE" > "$RUN_DIR/mode"
echo "$RUN_DIR" > "$BASE/active"

# serve.ts passes the server an explicit env (no inherited keys), so no paid
# provider key can leak in from this shell.
cd "$ROOT"
E2E_PORT="$PORT" nohup bun e2e/support/serve.ts > "$RUN_DIR/server.log" 2>&1 &
echo $! > "$RUN_DIR/server.pid"
started() { ps -o lstart= -p "$1" | awk '{$1=$1};1'; }
echo "$(cat "$RUN_DIR/server.pid") $(started "$(cat "$RUN_DIR/server.pid")")" > "$RUN_DIR/pids"
echo "launch: serve.ts pid $(cat "$RUN_DIR/server.pid"), log $RUN_DIR/server.log"

# Ready means usable: the API answers (which opens and migrates the embedded
# database) and the sign-in page renders with the mock instance's brand.
deadline=$((SECONDS + ${VERIFY_TIMEOUT:-420}))
until curl -fsS -o /dev/null "$URL/api/config" 2>/dev/null; do
  if ! kill -0 "$(cat "$RUN_DIR/server.pid")" 2>/dev/null; then
    echo "launch: serve.ts exited; tail of the log:" >&2
    tail -30 "$RUN_DIR/server.log" >&2
    exit 1
  fi
  if ((SECONDS > deadline)); then
    echo "launch: timed out waiting for $URL/api/config" >&2
    exit 1
  fi
  sleep 2
done
until [[ "$(curl -fsS "$URL/sign-in" 2>/dev/null)" == *"E2E Chat"* ]]; do
  if ((SECONDS > deadline)); then
    echo "launch: /sign-in never rendered the E2E Chat brand" >&2
    exit 1
  fi
  sleep 2
done

# `next dev` compiles a route on its first visit, and the signed-in shell
# takes 30-60 s cold, longer than a journey's 30 s expect timeout. Visit each
# signed-in route once with a placeholder session cookie: the proxy lets it
# through, the route compiles, and the layout redirects to sign-in.
if [[ "$MODE" == "dev" ]]; then
  for route in / /c/00000000-0000-4000-8000-000000000000 /settings/profile \
    /library /schedules /artifacts /dots; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 300 \
      -b 'better-auth.session_token=verify-warmup' "$URL$route" || true)"
    echo "launch: warmed $route ($code)"
  done
fi

# Record every process this run owns, with its start time, so cleanup kills
# only those: a pid alone may belong to another process by then.
collect() { echo "$1"; for c in $(pgrep -P "$1" 2>/dev/null); do collect "$c"; done; }
for p in $(collect "$(cat "$RUN_DIR/server.pid")" | sort -u); do
  echo "$p $(started "$p")"
done > "$RUN_DIR/pids"

echo "launch: READY $URL (mode $MODE)"
echo "RUN_DIR=$RUN_DIR"

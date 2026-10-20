#!/usr/bin/env bash
# Stops the instance a verify-web run started and nothing else. serve.ts
# deletes its temp dir (database, uploads, config) on SIGTERM. Evidence in
# $RUN_DIR/evidence is kept. Usage:
#   .claude/skills/verify-web/scripts/cleanup.sh [RUN_DIR]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BASE="$ROOT/.context/tmp/verify-web"
RUN_DIR="${1:-$(cat "$BASE/active" 2>/dev/null || true)}"
if [[ -z "$RUN_DIR" || ! -d "$RUN_DIR" ]]; then
  echo "cleanup: no active run"
  exit 0
fi
PORT="$(cat "$RUN_DIR/port" 2>/dev/null || echo "")"
PID="$(cat "$RUN_DIR/server.pid" 2>/dev/null || echo "")"

if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM "$PID"
  for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
fi
# Anything this run recorded that outlived serve.ts.
if [[ -f "$RUN_DIR/pids" ]]; then
  while read -r p; do
    kill -0 "$p" 2>/dev/null && kill -TERM "$p" 2>/dev/null
  done < "$RUN_DIR/pids"
  sleep 2
  while read -r p; do
    kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null
  done < "$RUN_DIR/pids"
fi

# Playwright's saved sign-in state is scratch, not evidence.
rm -rf "$RUN_DIR/auth"
[[ "$(cat "$BASE/active" 2>/dev/null)" == "$RUN_DIR" ]] && rm -f "$BASE/active"

if [[ -n "$PORT" ]] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "cleanup: WARNING port $PORT still has a listener this run did not record:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 1
fi
echo "cleanup: stopped; evidence kept in $RUN_DIR/evidence"

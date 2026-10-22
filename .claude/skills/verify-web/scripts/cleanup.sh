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
PIDS="$RUN_DIR/pids"

# A recorded pid is still ours only while its start time matches the one
# launch.sh wrote next to it. Otherwise the pid now names another process.
started() { ps -o lstart= -p "$1" 2>/dev/null | awk '{$1=$1};1'; }
ours() { grep -qxF "$1 $(started "$1")" "$PIDS" 2>/dev/null; }
signal() {
  [[ -f "$PIDS" ]] || return 0
  while read -r p _; do
    ours "$p" && kill "-$1" "$p" 2>/dev/null
  done < "$PIDS"
}

# serve.ts stops its children on TERM; KILL takes whatever outlived it.
SERVER="$(cat "$RUN_DIR/server.pid" 2>/dev/null || echo "")"
if [[ -n "$SERVER" ]] && ours "$SERVER"; then
  kill -TERM "$SERVER"
  for _ in $(seq 1 20); do ours "$SERVER" || break; sleep 1; done
fi
signal TERM
sleep 2
signal KILL
rm -f "$PIDS" "$RUN_DIR/server.pid"

# Playwright's saved sign-in state is scratch, not evidence.
rm -rf "$RUN_DIR/auth"
[[ "$(cat "$BASE/active" 2>/dev/null)" == "$RUN_DIR" ]] && rm -f "$BASE/active"

if [[ -n "$PORT" ]] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "cleanup: WARNING port $PORT still has a listener this run did not record:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 1
fi
echo "cleanup: stopped; evidence kept in $RUN_DIR/evidence"

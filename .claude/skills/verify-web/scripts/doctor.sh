#!/usr/bin/env bash
# Read-only: is the active verify-web instance worth driving? Exits non-zero
# with the first failed check. Usage:
#   .claude/skills/verify-web/scripts/doctor.sh [RUN_DIR]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BASE="$ROOT/.context/tmp/verify-web"
RUN_DIR="${1:-$(cat "$BASE/active" 2>/dev/null || true)}"
fail() { echo "doctor: FAIL $*"; exit 1; }
ok() { echo "doctor: ok   $*"; }

[[ -n "$RUN_DIR" && -d "$RUN_DIR" ]] || fail "no active run; start one with launch.sh"
PORT="$(cat "$RUN_DIR/port")"
PID="$(cat "$RUN_DIR/server.pid")"
URL="http://localhost:$PORT"
ok "run dir $RUN_DIR (mode $(cat "$RUN_DIR/mode"))"

[[ "$PORT" != "3000" ]] || fail "port 3000 belongs to the user's instance"
kill -0 "$PID" 2>/dev/null || fail "serve.ts (pid $PID) is not running"
ok "serve.ts pid $PID alive"

LISTENER="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
[[ -n "$LISTENER" ]] || fail "nothing listens on $PORT"
# `next dev` puts the listener a level or two below serve.ts: walk up.
owned=""
p="$LISTENER"
while [[ -n "$p" && "$p" != "1" && "$p" != "0" ]]; do
  if [[ "$p" == "$PID" ]]; then owned=1; break; fi
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
done
[[ -n "$owned" ]] || fail "port $PORT is owned by pid $LISTENER, which this run did not start"
ok "port $PORT owned by our next server (pid $LISTENER)"

# The server's working dir is serve.ts's temp dir, which holds its config.
CWD="$(lsof -a -p "$LISTENER" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
CONFIG="$CWD/app.config.yaml"
[[ -f "$CONFIG" ]] || fail "no app.config.yaml in the server's cwd ($CWD)"
# Spend guard: every provider baseURL must be loopback (the mock model server).
urls="$(grep -oE 'baseURL: *"[^"]*"' "$CONFIG")"
[[ -n "$urls" ]] || fail "no provider baseURL found in $CONFIG"
while read -r line; do
  [[ "$line" =~ ^baseURL:\ *\"http://(127\.0\.0\.1|localhost):[0-9]+ ]] ||
    fail "provider $line in $CONFIG is not a loopback mock; refusing to drive"
done <<< "$urls"
grep -qE '^decider: \{ adapter: none \}' "$CONFIG" || fail "decider is not disabled in $CONFIG"
ok "providers are loopback mocks only ($CONFIG)"

curl -fsS -o /dev/null "$URL/api/config" || fail "$URL/api/config does not answer"
[[ "$(curl -fsS "$URL/sign-in" 2>/dev/null)" == *"E2E Chat"* ]] || fail "$URL/sign-in lacks the E2E Chat brand"
ok "$URL answers as E2E Chat"
echo "doctor: HEALTHY $URL"

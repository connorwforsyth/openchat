#!/usr/bin/env bash
# Runs journeys against the active verify-web instance. Arguments are
# Playwright file filters (omit for all). The accounts journey runs first,
# once per instance; later invocations reuse its saved sign-in. Usage:
#   .claude/skills/verify-web/scripts/journey.sh            # every journey
#   .claude/skills/verify-web/scripts/journey.sh chat       # chat.journey.ts (+ accounts once)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SKILL="$ROOT/.claude/skills/verify-web"
RUN_DIR="${VERIFY_RUN_DIR:-$(cat "$ROOT/.context/tmp/verify-web/active")}"
export VERIFY_RUN_DIR="$RUN_DIR"

"$SKILL/scripts/doctor.sh" "$RUN_DIR" >/dev/null || {
  "$SKILL/scripts/doctor.sh" "$RUN_DIR"
  exit 1
}

extra=()
if [[ -f "$RUN_DIR/auth/ada.json" ]]; then
  # The instance already has its admin; signing up again would not be first.
  extra+=(--no-deps --project=journeys)
fi

# Bare names become exact journey paths: a plain filter like `chat` would
# match every file, since the checkout's own path may contain the word.
files=()
for name in "$@"; do
  files+=("$SKILL/journeys/${name%.journey.ts}.journey.ts")
done

cd "$ROOT"
"$ROOT/node_modules/.bin/playwright" test \
  --config "$SKILL/playwright.verify.config.ts" ${extra[@]+"${extra[@]}"} \
  ${files[@]+"${files[@]}"} 2>&1 |
  tee -a "$RUN_DIR/evidence/journeys.log"
exit "${PIPESTATUS[0]}"

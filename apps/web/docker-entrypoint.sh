#!/bin/sh
# The web container's entrypoint. Production refuses to run sign-in without
# BETTER_AUTH_SECRET, and to store provider keys without ENCRYPTION_KEY
# (.env.example). So that `docker compose up` works from a copied
# .env.example, whichever is unset is generated once, kept in the data
# volume, and reused on every start. Set your own in .env to manage them
# yourself (and keep them with your backups either way).
set -eu

# The data volume, relative to the working directory (apps/web).
secrets="$PWD/data/.secrets.env"

random_key() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
}

if [ -z "${BETTER_AUTH_SECRET:-}" ] || [ -z "${ENCRYPTION_KEY:-}" ]; then
  if [ ! -f "$secrets" ]; then
    (
      umask 077
      printf 'BETTER_AUTH_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(random_key)" "$(random_key)" > "$secrets"
    )
    echo "[web] generated BETTER_AUTH_SECRET and ENCRYPTION_KEY into $secrets (set them in .env to manage them yourself)" >&2
  fi
  while IFS='=' read -r name value; do
    case "$name" in
      BETTER_AUTH_SECRET)
        [ -n "${BETTER_AUTH_SECRET:-}" ] || export BETTER_AUTH_SECRET="$value"
        ;;
      ENCRYPTION_KEY)
        [ -n "${ENCRYPTION_KEY:-}" ] || export ENCRYPTION_KEY="$value"
        ;;
    esac
  done < "$secrets"
fi

exec "$@"

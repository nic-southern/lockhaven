#!/usr/bin/env sh
set -eu

if [ "${RUN_DB_MIGRATIONS_ON_START:-1}" != "0" ]; then
  echo "Applying database migrations..."
  (cd /repo/packages/db && node scripts/apply-migrations.mjs)
  # Keeps the Console's restricted login in step with any tables the
  # migrations just added. Skips itself when WEB_DB_PASSWORD is unset.
  (cd /repo/packages/db && node scripts/provision-roles.mjs)
fi

exec "$@"

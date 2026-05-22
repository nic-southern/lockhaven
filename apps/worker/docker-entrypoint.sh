#!/usr/bin/env sh
set -eu

if [ "${RUN_DB_MIGRATIONS_ON_START:-1}" != "0" ]; then
  echo "Applying database migrations..."
  (cd /repo/packages/db && node scripts/apply-migrations.mjs)
fi

exec "$@"

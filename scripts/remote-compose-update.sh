#!/usr/bin/env bash
set -euo pipefail

# Host-side update for an existing Lockhaven install.
# Expects /opt/lockhaven/.env.deploy and deploy/production.compose.yml.

ROOT_DIR="${LOCKHAVEN_ROOT:-/opt/lockhaven}"
COMPOSE_FILE="${LOCKHAVEN_COMPOSE_FILE:-deploy/production.compose.yml}"
ENV_FILE="${LOCKHAVEN_ENV_FILE:-.env.deploy}"

cd "$ROOT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing ${ROOT_DIR}/${ENV_FILE}" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Missing ${ROOT_DIR}/${COMPOSE_FILE}" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Pulling images..."
compose pull

echo "Ensuring data plane is up..."
compose up -d postgres redis guacamole-db guacd traefik

echo "Waiting for Postgres..."
for _ in $(seq 1 60); do
  if compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d nms_vpn >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d nms_vpn

echo "Waiting for Redis..."
for _ in $(seq 1 60); do
  if compose exec -T redis redis-cli ping >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
compose exec -T redis redis-cli ping

echo "Applying database migrations..."
compose run --rm migrate

echo "Starting application services..."
compose up -d --remove-orphans

echo "Update complete."

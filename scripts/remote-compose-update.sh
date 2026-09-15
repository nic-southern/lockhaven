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

# Host-side helpers shipped alongside the compose file. The worker container
# runs vpnctl through a read-only bind mount, and ulogd2 writes the connection
# flow log the worker tails, so both must be refreshed on the host itself.
if [ -f infra/systemd/vpnctl ]; then
  echo "Updating host vpnctl..."
  install -m 0755 infra/systemd/vpnctl /usr/local/sbin/vpnctl
fi

if [ -f infra/systemd/install-flow-logging.sh ]; then
  echo "Configuring connection flow logging..."
  bash infra/systemd/install-flow-logging.sh
fi

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

if ! grep -q '^WEB_DB_PASSWORD=' "$ENV_FILE"; then
  echo "Adding restricted web database credentials..."
  web_db_password="$(openssl rand -hex 16)"
  {
    echo "WEB_DB_PASSWORD=${web_db_password}"
    echo "WEB_DATABASE_URL=postgresql://lockhaven_web:${web_db_password}@postgres:5432/nms_vpn"
  } >> "$ENV_FILE"
fi

echo "Applying database migrations..."
compose run --rm migrate

echo "Starting application services..."
compose up -d --remove-orphans

echo "Update complete."

#!/usr/bin/env bash
# Restore a Lockhaven backup created by scripts/backup.sh.
# Requires BACKUP_PASSPHRASE in the environment. Never prints the passphrase
# or dump contents. Destructive: replaces control-plane and session-gateway
# data from the archive.
set -euo pipefail

ROOT_DIR="${LOCKHAVEN_ROOT:-/opt/lockhaven}"
ENV_FILE="${LOCKHAVEN_ENV_FILE:-${ROOT_DIR}/.env.deploy}"
WG_DIR="${LOCKHAVEN_WG_DIR:-/etc/wireguard}"
DRY_RUN="${DRY_RUN:-0}"
OPENSSL_ITER="${LOCKHAVEN_BACKUP_PBKDF2_ITER:-200000}"
ARCHIVE="${1:-}"

log() {
  printf '%s\n' "$*"
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  die "BACKUP_PASSPHRASE is not set"
fi

if [ -z "$ARCHIVE" ]; then
  die "Usage: restore.sh /path/to/lockhaven-YYYYMMDDThhmmssZ.tar.enc"
fi

if [ ! -f "$ARCHIVE" ]; then
  die "Backup archive not found"
fi

require_cmd openssl
require_cmd tar

if [ "$DRY_RUN" != "1" ]; then
  require_cmd pg_restore
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/lockhaven-restore.XXXXXX")"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter "$OPENSSL_ITER" \
  -pass env:BACKUP_PASSPHRASE -in "$ARCHIVE" | tar -xz -C "$work"; then
  die "Could not decrypt or unpack the archive"
fi

if [ "$DRY_RUN" = "1" ]; then
  log "Dry run: archive decrypted. Restore would apply dumps and replace host files."
  if [ -f "$work/control-plane.dump" ]; then
    log "Control-plane dump is present."
  fi
  if [ -f "$work/session-gateway.dump" ]; then
    log "Session-gateway dump is present."
  fi
  if [ -f "$work/hub.env" ]; then
    log "Hub environment file is present."
  fi
  if [ -d "$work/wireguard" ]; then
    log "Tunnel key directory is present."
  fi
  exit 0
fi

if [ -f "$work/hub.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$work/hub.env"
  set +a
elif [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL is missing; cannot restore the control plane}"

restore_db() {
  local url="$1"
  local dump="$2"
  [ -f "$dump" ] || return 0
  pg_restore --clean --if-exists --no-owner --dbname="$url" "$dump"
}

restore_db "$DATABASE_URL" "$work/control-plane.dump"
if [ -n "${GUACAMOLE_DATABASE_URL:-}" ]; then
  restore_db "$GUACAMOLE_DATABASE_URL" "$work/session-gateway.dump"
fi

if [ -f "$work/hub.env" ]; then
  install -d -m 0700 "$(dirname "$ENV_FILE")"
  install -m 0600 "$work/hub.env" "$ENV_FILE"
fi

if [ -d "$work/wireguard" ]; then
  install -d -m 0700 "$WG_DIR"
  find "$work/wireguard" -maxdepth 1 -type f -exec install -m 0600 {} "$WG_DIR/" \;
fi

log "Restore finished. Restart the hub stack before serving traffic."

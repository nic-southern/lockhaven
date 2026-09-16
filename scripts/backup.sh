#!/usr/bin/env bash
# Encrypted Lockhaven backup. Reads BACKUP_PASSPHRASE from the environment
# (typically /opt/lockhaven/backup.env). Never prints the passphrase or dump
# contents.
set -euo pipefail

ROOT_DIR="${LOCKHAVEN_ROOT:-/opt/lockhaven}"
ENV_FILE="${LOCKHAVEN_ENV_FILE:-${ROOT_DIR}/.env.deploy}"
WG_DIR="${LOCKHAVEN_WG_DIR:-/etc/wireguard}"
BACKUP_DIR="${LOCKHAVEN_BACKUP_DIR:-/var/backups/lockhaven}"
KEEP="${LOCKHAVEN_BACKUP_KEEP:-14}"
DRY_RUN="${DRY_RUN:-0}"
OPENSSL_ITER="${LOCKHAVEN_BACKUP_PBKDF2_ITER:-200000}"

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

# Refuse to print or interpolate the passphrase into logs.
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  die "BACKUP_PASSPHRASE is not set"
fi

require_cmd openssl
require_cmd tar
require_cmd mktemp

if [ "$DRY_RUN" != "1" ]; then
  require_cmd pg_dump
fi

if [ ! -f "$ENV_FILE" ]; then
  die "Missing environment file: $ENV_FILE"
fi

# Load connection settings without echoing values.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is missing from the environment file}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d "${TMPDIR:-/tmp}/lockhaven-backup.XXXXXX")"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/wireguard"
cp -a "$ENV_FILE" "$work/hub.env"
chmod 600 "$work/hub.env"

if [ -d "$WG_DIR" ]; then
  # Copy key material into the work dir; the archive is encrypted next.
  find "$WG_DIR" -maxdepth 1 -type f -exec cp -a {} "$work/wireguard/" \;
fi

dump_db() {
  local url="$1"
  local dest="$2"
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  pg_dump --format=custom --file="$dest" "$url"
}

if [ "$DRY_RUN" = "1" ]; then
  log "Dry run: environment, openssl, and paths look usable."
  log "Would write an encrypted archive under ${BACKUP_DIR}"
  if [ -n "${RCLONE_REMOTE:-}" ]; then
    log "Would copy the archive with rclone (remote name omitted)."
  fi
  exit 0
fi

dump_db "$DATABASE_URL" "$work/control-plane.dump"
if [ -n "${GUACAMOLE_DATABASE_URL:-}" ]; then
  dump_db "$GUACAMOLE_DATABASE_URL" "$work/session-gateway.dump"
fi

install -d -m 0700 "$BACKUP_DIR"
archive="${BACKUP_DIR}/lockhaven-${stamp}.tar.enc"

tar -C "$work" -czf - . \
  | openssl enc -aes-256-cbc -pbkdf2 -iter "$OPENSSL_ITER" -salt \
    -pass env:BACKUP_PASSPHRASE -out "$archive"
chmod 600 "$archive"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  require_cmd rclone
  rclone copy "$archive" "${RCLONE_REMOTE}/" --quiet
fi

if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/lockhaven-*.tar.enc 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
  done
fi

log "Wrote encrypted backup ${archive}"

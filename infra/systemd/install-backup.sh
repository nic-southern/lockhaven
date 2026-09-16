#!/usr/bin/env bash
# Installs the Lockhaven backup timer. Safe to re-run. Does not write
# BACKUP_PASSPHRASE; keep that in /opt/lockhaven/backup.env (mode 600).
set -euo pipefail

ROOT_DIR="${LOCKHAVEN_ROOT:-/opt/lockhaven}"
UNIT_DIR="${LOCKHAVEN_SYSTEMD_DIR:-/etc/systemd/system}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-backup.sh must run as root" >&2
  exit 1
fi

# GNU install exits 1 when source and dest are the same inode (the git tree
# on the droplet is /opt/lockhaven). Skip the copy in that case and keep
# the existing scripts executable.
install_script() {
  local src dest src_path dest_path
  src="$1"
  dest="$2"
  src_path="$(readlink -f "$src")"
  dest_path="$(readlink -f "$dest")"
  if [ "$src_path" = "$dest_path" ]; then
    chmod 0755 "$dest"
    return
  fi
  install -m 0755 "$src" "$dest"
}

install -d -m 0755 "${ROOT_DIR}/scripts"
if [ -f "${SCRIPT_DIR}/../../scripts/backup.sh" ]; then
  install_script "${SCRIPT_DIR}/../../scripts/backup.sh" "${ROOT_DIR}/scripts/backup.sh"
  install_script "${SCRIPT_DIR}/../../scripts/restore.sh" "${ROOT_DIR}/scripts/restore.sh"
fi

install -m 0644 "${SCRIPT_DIR}/lockhaven-backup.service" "${UNIT_DIR}/lockhaven-backup.service"
install -m 0644 "${SCRIPT_DIR}/lockhaven-backup.timer" "${UNIT_DIR}/lockhaven-backup.timer"

if [ ! -f "${ROOT_DIR}/backup.env" ]; then
  cat > "${ROOT_DIR}/backup.env" <<'EOF'
# chmod 600 this file. Do not commit it. BACKUP_PASSPHRASE is required.
BACKUP_PASSPHRASE=
# Optional off-host copy. Configure rclone separately; do not put tokens here
# if they already live in rclone's config.
# RCLONE_REMOTE=remote:bucket/lockhaven
EOF
  chmod 600 "${ROOT_DIR}/backup.env"
  echo "Created ${ROOT_DIR}/backup.env — set BACKUP_PASSPHRASE before enabling the timer."
fi

systemctl daemon-reload
if grep -Eq '^BACKUP_PASSPHRASE=.+' "${ROOT_DIR}/backup.env" && \
  ! grep -Eq '^BACKUP_PASSPHRASE=[[:space:]]*$' "${ROOT_DIR}/backup.env"; then
  systemctl enable --now lockhaven-backup.timer
  echo "Backup timer installed and enabled."
else
  echo "Units installed. Set BACKUP_PASSPHRASE in ${ROOT_DIR}/backup.env, then run: systemctl enable --now lockhaven-backup.timer"
fi

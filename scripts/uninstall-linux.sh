#!/usr/bin/env bash
set -euo pipefail

tunnel_name="${LOCKHAVEN_TUNNEL_NAME:-lockhaven}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This uninstaller must run as root. Re-run with sudo." >&2
  exit 1
fi

config_path="/etc/wireguard/${tunnel_name}.conf"
secret_path="/var/lib/lockhaven/${tunnel_name}.check-in-secret"
ssh_public_key_path="/var/lib/lockhaven/${tunnel_name}.ssh-public-key"
ssh_username_path="/var/lib/lockhaven/${tunnel_name}.ssh-username"

remove_ssh_authorized_key() {
  local ssh_username ssh_public_key home_dir auth_keys

  if [ ! -f "$ssh_public_key_path" ]; then
    return
  fi

  ssh_public_key="$(tr -d '\r\n' <"$ssh_public_key_path")"
  ssh_username="root"
  if [ -f "$ssh_username_path" ]; then
    ssh_username="$(tr -d '\r\n' <"$ssh_username_path")"
  fi

  if [ -z "$ssh_public_key" ]; then
    return
  fi

  if [ "$ssh_username" = "root" ]; then
    home_dir="/root"
  else
    home_dir="$(getent passwd "$ssh_username" | cut -d: -f6 || true)"
  fi

  if [ -z "$home_dir" ]; then
    return
  fi

  auth_keys="${home_dir}/.ssh/authorized_keys"
  if [ ! -f "$auth_keys" ]; then
    return
  fi

  if grep -Fqx "$ssh_public_key" "$auth_keys"; then
    grep -Fvx "$ssh_public_key" "$auth_keys" >"${auth_keys}.tmp" || true
    mv "${auth_keys}.tmp" "$auth_keys"
    chown "$ssh_username:$ssh_username" "$auth_keys" 2>/dev/null || true
    chmod 0600 "$auth_keys"
    echo "SSH public key removed for ${ssh_username}."
  fi
}

echo "Removing ${tunnel_name} tunnel..."

if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now "wg-quick@${tunnel_name}" >/dev/null 2>&1 || true
fi

if command -v wg-quick >/dev/null 2>&1; then
  wg-quick down "$tunnel_name" >/dev/null 2>&1 || true
fi

remove_ssh_authorized_key

rm -f "$config_path" "$secret_path" "$ssh_public_key_path" "$ssh_username_path"

if [ -d /var/lib/lockhaven ] && [ -z "$(ls -A /var/lib/lockhaven 2>/dev/null || true)" ]; then
  rmdir /var/lib/lockhaven 2>/dev/null || true
fi

echo "Uninstall complete."
echo "Tunnel interface and local Lockhaven files were removed."
echo "Revoke the device in the Console if it should no longer appear there."

#!/usr/bin/env bash
set -euo pipefail

base_url="${LOCKHAVEN_BASE_URL:-}"
token="${LOCKHAVEN_TOKEN:-}"
device_id="${LOCKHAVEN_DEVICE_ID:-}"
tunnel_name="${LOCKHAVEN_TUNNEL_NAME:-lockhaven}"
install_dir="${LOCKHAVEN_INSTALL_DIR:-/usr/sbin}"

usage() {
  cat <<'EOF'
Usage:
  LOCKHAVEN_TOKEN=<token> bash install-lockhaven-agent.sh

Optional environment variables:
  LOCKHAVEN_BASE_URL     Hub URL. Defaults to the server that served this script.
  LOCKHAVEN_DEVICE_ID    Attach to this listed device when hostname/serial are ambiguous
  LOCKHAVEN_TUNNEL_NAME   Tunnel interface name. Defaults to lockhaven
  LOCKHAVEN_INSTALL_DIR   Binary directory. Defaults to /usr/sbin
EOF
}

if [ "$(id -u)" -ne 0 ]; then
  echo "This installer must run as root. Re-run with sudo." >&2
  exit 1
fi

if [ -z "$base_url" ]; then
  if [ -n "${LOCKHAVEN_INSTALL_ORIGIN:-}" ]; then
    base_url="$LOCKHAVEN_INSTALL_ORIGIN"
  fi
fi

if [ -z "$base_url" ]; then
  echo "Set LOCKHAVEN_BASE_URL to the Hub address." >&2
  usage >&2
  exit 1
fi

base_url="${base_url%/}"

arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) goarch="amd64" ;;
  aarch64 | arm64) goarch="arm64" ;;
  *)
    echo "This architecture is not supported yet." >&2
    exit 1
    ;;
esac

binary_url="${base_url}/install/lockhaven-agent-linux-${goarch}"
tmp="$(mktemp)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

if ! command -v curl >/dev/null 2>&1; then
  echo "Install curl, then rerun this script." >&2
  exit 1
fi

echo "Downloading the Lockhaven agent..."
curl -fsSL "$binary_url" -o "$tmp"
chmod 0755 "$tmp"

install -d -m 0755 "$install_dir"
install -m 0755 "$tmp" "${install_dir}/lockhaven-agent"

export LOCKHAVEN_TOKEN="$token"
export LOCKHAVEN_BASE_URL="$base_url"
export LOCKHAVEN_TUNNEL_NAME="$tunnel_name"
if [ -n "$device_id" ]; then
  export LOCKHAVEN_DEVICE_ID="$device_id"
fi

if [ -z "$token" ] && [ ! -f /var/lib/lockhaven/agent.json ]; then
  echo "Set LOCKHAVEN_TOKEN, or install on a device that already has local agent state." >&2
  usage >&2
  exit 1
fi

exec "${install_dir}/lockhaven-agent" install

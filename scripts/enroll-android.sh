#!/usr/bin/env bash
# Operator-side Android enrollment: create a WireGuard .conf (and optional QR)
# for import into the official WireGuard app on the device.
# Does not start a tunnel on this machine.
set -euo pipefail

base_url="${LOCKHAVEN_BASE_URL:-https://vpn.newmarketsecurity.com}"
token="${LOCKHAVEN_TOKEN:-}"
serial_number="${LOCKHAVEN_SERIAL:-${LOCKHAVEN_SERIAL_NUMBER:-}}"
hostname="${LOCKHAVEN_HOSTNAME:-}"
os_version="${LOCKHAVEN_OS_VERSION:-Android}"
architecture="${LOCKHAVEN_ARCHITECTURE:-arm64}"
out_dir="${LOCKHAVEN_OUT_DIR:-.}"

usage() {
  cat <<'EOF'
Usage:
  LOCKHAVEN_TOKEN=<token> bash enroll-android.sh

Run on a workstation (Mac/Linux). Import the resulting .conf or QR into the
WireGuard app on the Android device. This script does not bring up a local tunnel.

Optional environment variables:
  LOCKHAVEN_BASE_URL       Enrollment server URL. Defaults to https://vpn.newmarketsecurity.com
  LOCKHAVEN_HOSTNAME       Device name in Console. Defaults to android-<serial>
  LOCKHAVEN_SERIAL         Device serial (also LOCKHAVEN_SERIAL_NUMBER). Defaults to unknown
  LOCKHAVEN_OS_VERSION     OS version string. Defaults to Android
  LOCKHAVEN_ARCHITECTURE   Architecture. Defaults to arm64
  LOCKHAVEN_OUT_DIR        Directory for .conf / QR output. Defaults to current directory

Requires: wg (wireguard-tools), curl, python3. Optional: qrencode for QR output.
EOF
}

if [ -z "$token" ]; then
  usage >&2
  exit 1
fi

if ! command -v wg >/dev/null 2>&1; then
  echo "Install wireguard-tools (wg), then rerun this script." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Install curl, then rerun this script." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Install python3, then rerun this script." >&2
  exit 1
fi

if [ -z "$serial_number" ]; then
  serial_number="unknown"
fi

if [ -z "$hostname" ]; then
  hostname="android-${serial_number}"
fi

# Safe filename fragment from hostname
safe_name="$(printf '%s' "$hostname" | tr -c 'A-Za-z0-9._-' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
if [ -z "$safe_name" ]; then
  safe_name="android"
fi

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

json_escape() {
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

json_get() {
  python3 -c 'import json, sys; data=json.load(sys.stdin); path=sys.argv[1].split(".");
for key in path:
    data=data[key]
print(data if not isinstance(data, list) else ", ".join(data))' "$1"
}

private_key="$(wg genkey)"
public_key="$(printf '%s' "$private_key" | wg pubkey)"
enroll_url="${base_url%/}/api/enroll"

payload="$(cat <<EOF
{
  "token": $(printf '%s' "$token" | json_escape),
  "hostname": $(printf '%s' "$hostname" | json_escape),
  "os_family": "android",
  "os_version": $(printf '%s' "$os_version" | json_escape),
  "architecture": $(printf '%s' "$architecture" | json_escape),
  "serial_number": $(printf '%s' "$serial_number" | json_escape),
  "wireguard_public_key": $(printf '%s' "$public_key" | json_escape),
  "services": []
}
EOF
)"

echo "Enrolling Android device ${hostname} with ${enroll_url}..."
response="$(curl -fsS -X POST "$enroll_url" -H "content-type: application/json" --data "$payload")"

vpn_ipv4="$(printf '%s' "$response" | json_get vpn_ipv4)"
server_public_key="$(printf '%s' "$response" | json_get wireguard.server_public_key)"
endpoint="$(printf '%s' "$response" | json_get wireguard.endpoint)"
allowed_ips="$(printf '%s' "$response" | json_get wireguard.allowed_ips)"
persistent_keepalive="$(printf '%s' "$response" | json_get wireguard.persistent_keepalive)"
device_id="$(printf '%s' "$response" | json_get device_id)"

config_path="${out_dir}/lockhaven-${safe_name}.conf"

cat >"$config_path" <<EOF
[Interface]
Address = ${vpn_ipv4}
PrivateKey = ${private_key}

[Peer]
PublicKey = ${server_public_key}
Endpoint = ${endpoint}
AllowedIPs = ${allowed_ips}
PersistentKeepalive = ${persistent_keepalive}
EOF

chmod 0600 "$config_path"

echo
echo "WireGuard config written (for the Android device only — not this machine):"
echo "  ${config_path}"
echo "  Device ID: ${device_id}"
echo "  VPN address: ${vpn_ipv4}"
echo
echo "Import steps:"
echo "  1. Install WireGuard from the Play Store on the device."
echo "  2. Add a tunnel from file or QR code (below if qrencode is installed)."
echo "  3. Activate the tunnel. Online status uses the WireGuard handshake."
echo "  4. For remote screen: enable wireless debugging / adb tcpip 5555,"
echo "     then: adb connect ${vpn_ipv4%/*}:5555 && scrcpy"
echo

if command -v qrencode >/dev/null 2>&1; then
  qr_path="${out_dir}/lockhaven-${safe_name}.png"
  qrencode -t PNG -o "$qr_path" <"$config_path"
  echo "QR code image: ${qr_path}"
  echo
  echo "Terminal QR (scan with WireGuard → Create from QR code):"
  qrencode -t ANSIUTF8 <"$config_path"
else
  echo "Install qrencode to also emit a scannable QR for the WireGuard app."
fi

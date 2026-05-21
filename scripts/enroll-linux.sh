#!/usr/bin/env bash
set -euo pipefail

base_url="${LOCKHAVEN_BASE_URL:-https://vpn.newmarketsecurity.com}"
token="${LOCKHAVEN_TOKEN:-}"
hostname="${LOCKHAVEN_HOSTNAME:-$(hostname)}"
os_version="${LOCKHAVEN_OS_VERSION:-$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-unknown}")}"
architecture="${LOCKHAVEN_ARCHITECTURE:-$(uname -m)}"
serial_number="${LOCKHAVEN_SERIAL_NUMBER:-$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || hostname)}"
tunnel_name="${LOCKHAVEN_TUNNEL_NAME:-lockhaven}"

usage() {
  cat <<'EOF'
Usage:
  LOCKHAVEN_TOKEN=<token> bash enroll-linux.sh

Optional environment variables:
  LOCKHAVEN_BASE_URL       Enrollment server URL. Defaults to https://vpn.newmarketsecurity.com
  LOCKHAVEN_HOSTNAME       Device hostname. Defaults to hostname(1)
  LOCKHAVEN_OS_VERSION     OS version string. Defaults to /etc/os-release PRETTY_NAME
  LOCKHAVEN_ARCHITECTURE   Device architecture. Defaults to uname -m
  LOCKHAVEN_SERIAL_NUMBER  Device serial number. Defaults to product_uuid or hostname
  LOCKHAVEN_TUNNEL_NAME    WireGuard interface name. Defaults to lockhaven
EOF
}

if [ -z "$token" ]; then
  usage >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "This installer must run as root. Re-run with sudo." >&2
  exit 1
fi

install_dependencies() {
  if command -v wg >/dev/null 2>&1 &&
    command -v wg-quick >/dev/null 2>&1 &&
    command -v curl >/dev/null 2>&1 &&
    command -v python3 >/dev/null 2>&1; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools curl python3
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y wireguard-tools curl python3
  elif command -v yum >/dev/null 2>&1; then
    yum install -y wireguard-tools curl python3
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache wireguard-tools curl python3
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm wireguard-tools curl python
  else
    echo "Install wireguard-tools, curl, and python3, then rerun this script." >&2
    exit 1
  fi
}

json_escape() {
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

json_get() {
  python3 -c 'import json, sys; data=json.load(sys.stdin); path=sys.argv[1].split(".");
for key in path:
    data=data[key]
print(data if not isinstance(data, list) else ", ".join(data))' "$1"
}

install_dependencies

private_key="$(wg genkey)"
public_key="$(printf '%s' "$private_key" | wg pubkey)"
enroll_url="${base_url%/}/api/enroll"

payload="$(cat <<EOF
{
  "token": $(printf '%s' "$token" | json_escape),
  "hostname": $(printf '%s' "$hostname" | json_escape),
  "os_family": "linux",
  "os_version": $(printf '%s' "$os_version" | json_escape),
  "architecture": $(printf '%s' "$architecture" | json_escape),
  "serial_number": $(printf '%s' "$serial_number" | json_escape),
  "wireguard_public_key": $(printf '%s' "$public_key" | json_escape),
  "services": [
    {
      "type": "ssh",
      "protocol": "tcp",
      "port": 22
    }
  ]
}
EOF
)"

echo "Enrolling device with ${enroll_url}..."
response="$(curl -fsS -X POST "$enroll_url" -H "content-type: application/json" --data "$payload")"

vpn_ipv4="$(printf '%s' "$response" | json_get vpn_ipv4)"
server_public_key="$(printf '%s' "$response" | json_get wireguard.server_public_key)"
endpoint="$(printf '%s' "$response" | json_get wireguard.endpoint)"
allowed_ips="$(printf '%s' "$response" | json_get wireguard.allowed_ips)"
persistent_keepalive="$(printf '%s' "$response" | json_get wireguard.persistent_keepalive)"
check_in_secret="$(printf '%s' "$response" | json_get check_in_secret)"

install -d -m 0700 /etc/wireguard /var/lib/lockhaven
config_path="/etc/wireguard/${tunnel_name}.conf"
secret_path="/var/lib/lockhaven/${tunnel_name}.check-in-secret"

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

printf '%s\n' "$check_in_secret" >"$secret_path"
chmod 0600 "$config_path" "$secret_path"

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now "wg-quick@${tunnel_name}"
else
  wg-quick down "$tunnel_name" >/dev/null 2>&1 || true
  wg-quick up "$tunnel_name"
fi

echo "WireGuard tunnel ready."
echo "Interface: ${tunnel_name}"
echo "Config: ${config_path}"
echo "Check-in secret: ${secret_path}"

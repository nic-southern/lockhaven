#!/usr/bin/env bash
# Installs ulogd2 on the concentrator and points it at the NFLOG group that
# `vpnctl sync-firewall` logs new wg0 connections to. Output is one JSON line
# per connection in /var/log/lockhaven/flows.jsonl, which the worker's
# flow-ingest job tails. Safe to re-run; it only rewrites config and restarts
# ulogd2 when something changed.
set -euo pipefail

FLOW_DIR="${LOCKHAVEN_FLOW_DIR:-/var/log/lockhaven}"
FLOW_FILE="${LOCKHAVEN_FLOW_FILE:-${FLOW_DIR}/flows.jsonl}"
NFLOG_GROUP="${LOCKHAVEN_FLOW_NFLOG_GROUP:-1}"
ULOGD_CONF="/etc/ulogd.conf"
LOGROTATE_CONF="/etc/logrotate.d/lockhaven-flows"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-flow-logging.sh must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if ! dpkg -s ulogd2 ulogd2-json >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ulogd2 ulogd2-json
fi

multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH 2>/dev/null || echo x86_64-linux-gnu)"
plugin_dir="/usr/lib/${multiarch}/ulogd"
if [ ! -d "$plugin_dir" ]; then
  plugin_dir="$(dirname "$(find /usr/lib -name 'ulogd_output_JSON.so' | head -n 1)")"
fi

install -d -m 0755 "$FLOW_DIR"

tmp_conf="$(mktemp)"
cat >"$tmp_conf" <<EOF
# Managed by Lockhaven (infra/systemd/install-flow-logging.sh).
[global]
logfile="/var/log/ulogd.log"
loglevel=3

plugin="${plugin_dir}/ulogd_inppkt_NFLOG.so"
plugin="${plugin_dir}/ulogd_raw2packet_BASE.so"
plugin="${plugin_dir}/ulogd_filter_IFINDEX.so"
plugin="${plugin_dir}/ulogd_filter_IP2STR.so"
plugin="${plugin_dir}/ulogd_output_JSON.so"

stack=flows:NFLOG,base:BASE,ifindex:IFINDEX,ip2str:IP2STR,json:JSON

[flows]
group=${NFLOG_GROUP}
netlink_socket_buffer_size=1048576
netlink_socket_buffer_maxsize=4194304

[json]
sync=1
timestamp=1
boolean_label=0
file="${FLOW_FILE}"
EOF

tmp_rotate="$(mktemp)"
cat >"$tmp_rotate" <<EOF
${FLOW_FILE} {
  daily
  maxsize 256M
  rotate 7
  missingok
  notifempty
  compress
  delaycompress
  copytruncate
}
EOF

changed=0
if ! cmp -s "$tmp_conf" "$ULOGD_CONF"; then
  install -m 0644 "$tmp_conf" "$ULOGD_CONF"
  changed=1
fi
if ! cmp -s "$tmp_rotate" "$LOGROTATE_CONF"; then
  install -m 0644 "$tmp_rotate" "$LOGROTATE_CONF"
fi
rm -f "$tmp_conf" "$tmp_rotate"

systemctl enable ulogd2 >/dev/null 2>&1 || true
if [ "$changed" -eq 1 ] || ! systemctl is-active --quiet ulogd2; then
  systemctl restart ulogd2
fi

echo "Flow logging active: ${FLOW_FILE} (NFLOG group ${NFLOG_GROUP})"

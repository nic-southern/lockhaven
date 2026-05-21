#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-nmstest}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/newmarketsecurity}"
APP_HOSTNAME="${APP_HOSTNAME:-app.example.com}"
GUAC_HOSTNAME="${GUAC_HOSTNAME:-guac.example.com}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)

log() {
  printf '\n==> %s\n' "$*"
}

require_local_file() {
  if [ ! -f "$1" ]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_local_file ".env"
require_local_file "deploy/nmstest.compose.yml"

log "Checking SSH access to ${REMOTE_HOST}"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "true"

log "Installing host packages"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg rsync wireguard docker.io openssl

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2
fi

systemctl enable --now docker
REMOTE

log "Creating remote app directory"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "mkdir -p '$REMOTE_APP_DIR'"

log "Copying repository to ${REMOTE_HOST}:${REMOTE_APP_DIR}"
rsync -az --delete \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude "**/node_modules/" \
  --exclude ".next/" \
  --exclude "**/.next/" \
  --exclude "dist/" \
  --exclude "**/dist/" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "private.pem" \
  --exclude "public.pem" \
  ./ "${REMOTE_HOST}:${REMOTE_APP_DIR}/"

log "Copying local .env as remote source env"
scp "${SSH_OPTS[@]}" .env "${REMOTE_HOST}:${REMOTE_APP_DIR}/.env.source"

log "Configuring WireGuard host interface and remote env"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "REMOTE_APP_DIR='$REMOTE_APP_DIR' APP_HOSTNAME='$APP_HOSTNAME' GUAC_HOSTNAME='$GUAC_HOSTNAME' bash -s" <<'REMOTE'
set -euo pipefail

mkdir -p /etc/wireguard
chmod 700 /etc/wireguard

if [ ! -f /etc/wireguard/server_private.key ]; then
  wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
  chmod 600 /etc/wireguard/server_private.key
fi

SERVER_PRIVATE_KEY="$(cat /etc/wireguard/server_private.key)"
SERVER_PUBLIC_KEY="$(cat /etc/wireguard/server_public.key)"

cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.80.0.1/16
ListenPort = 51820
PrivateKey = ${SERVER_PRIVATE_KEY}
SaveConfig = false
EOF

sysctl -w net.ipv4.ip_forward=1 >/dev/null
cat > /etc/sysctl.d/99-newmarketsecurity.conf <<'EOF'
net.ipv4.ip_forward=1
EOF

install -d -m 0755 /etc/traefik/certs /etc/traefik/dynamic

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "/etc/traefik/certs/${APP_HOSTNAME}.key" \
  -out "/etc/traefik/certs/${APP_HOSTNAME}.crt" \
  -subj "/CN=${APP_HOSTNAME}" \
  -addext "subjectAltName=DNS:${APP_HOSTNAME},DNS:*.${APP_HOSTNAME},DNS:${GUAC_HOSTNAME}"
chmod 600 "/etc/traefik/certs/${APP_HOSTNAME}.key"
chmod 644 "/etc/traefik/certs/${APP_HOSTNAME}.crt"

cat > /etc/traefik/dynamic/tls.yml <<EOF
tls:
  certificates:
    - certFile: /etc/traefik/certs/${APP_HOSTNAME}.crt
      keyFile: /etc/traefik/certs/${APP_HOSTNAME}.key
EOF

install -m 0755 "${REMOTE_APP_DIR}/infra/systemd/vpnctl" /usr/local/sbin/vpnctl

# Keep nftables disabled for the local test VM. Docker owns NAT rules needed
# during image builds, and a full ruleset flush breaks container DNS.
systemctl disable --now nftables >/dev/null 2>&1 || true
systemctl restart docker
systemctl enable --now wg-quick@wg0
systemctl restart wg-quick@wg0

cd "$REMOTE_APP_DIR"
awk '
  /^[A-Za-z_][A-Za-z0-9_]*=/ &&
  !/^(DATABASE_URL|REDIS_URL|APP_BASE_URL|BETTER_AUTH_URL|NEXTAUTH_URL|VPN_PUBLIC_HOSTNAME|VPN_SERVER_PUBLIC_KEY|VPN_PUBLIC_PORT|VPN_SERVER_IP|VPN_DEFAULT_ALLOWED_IPS|WIREGUARD_INTERFACE|VPNCTL_PATH)=/
' .env.source > .env.deploy

if ! grep -q '^BETTER_AUTH_SECRET=' .env.deploy && grep -q '^NEXTAUTH_SECRET=' .env.deploy; then
  grep '^NEXTAUTH_SECRET=' .env.deploy | tail -n 1 | sed 's/^NEXTAUTH_SECRET=/BETTER_AUTH_SECRET=/' >> .env.deploy
fi

if ! grep -q '^ADMIN_EMAIL=' .env.deploy; then
  echo 'ADMIN_EMAIL=admin@example.com' >> .env.deploy
fi

if ! grep -q '^ADMIN_PASSWORD=' .env.deploy; then
  admin_password="$(openssl rand -hex 16)"
  echo "ADMIN_PASSWORD=${admin_password}" >> .env.deploy
  printf '\n==> Generated admin password: %s\n' "$admin_password"
fi

if ! grep -q '^ADMIN_NAME=' .env.deploy; then
  echo 'ADMIN_NAME=Nic' >> .env.deploy
fi

if ! grep -q '^ADMIN_ROLE=' .env.deploy; then
  echo 'ADMIN_ROLE=owner' >> .env.deploy
fi

if ! grep -q '^REMOTE_CREDENTIALS_KEY=' .env.deploy; then
  if grep -q '^BETTER_AUTH_SECRET=' .env.deploy; then
    grep '^BETTER_AUTH_SECRET=' .env.deploy | tail -n 1 | sed 's/^BETTER_AUTH_SECRET=/REMOTE_CREDENTIALS_KEY=/' >> .env.deploy
  else
    echo "REMOTE_CREDENTIALS_KEY=$(openssl rand -hex 32)" >> .env.deploy
  fi
fi

if ! grep -q '^POSTGRES_PASSWORD=' .env.deploy; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env.deploy
fi

if ! grep -q '^GUACAMOLE_DB_PASSWORD=' .env.deploy; then
  echo "GUACAMOLE_DB_PASSWORD=$(openssl rand -hex 16)" >> .env.deploy
fi

cat >> .env.deploy <<EOF
APP_BASE_URL=https://${APP_HOSTNAME}
BETTER_AUTH_URL=https://${APP_HOSTNAME}
NEXTAUTH_URL=https://${APP_HOSTNAME}
NEXT_PUBLIC_APP_URL=https://${APP_HOSTNAME}
GUAC_HOSTNAME=${GUAC_HOSTNAME}
GUACAMOLE_BASE_URL=https://${GUAC_HOSTNAME}/guacamole/
GUACAMOLE_DATABASE_URL=postgresql://guacamole:${GUACAMOLE_DB_PASSWORD}@guacamole-db:5432/guacamole_db
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/nms_vpn
REDIS_URL=redis://127.0.0.1:6379/0
VPN_PUBLIC_HOSTNAME=${APP_HOSTNAME}
VPN_PUBLIC_PORT=51820
VPN_SERVER_IP=10.80.0.1
VPN_SERVER_PUBLIC_KEY=${SERVER_PUBLIC_KEY}
VPN_DEFAULT_ALLOWED_IPS=10.80.0.1/32
WIREGUARD_INTERFACE=wg0
VPNCTL_PATH=/usr/local/sbin/vpnctl
EOF

chmod 600 .env.source .env.deploy
REMOTE

log "Building and starting application containers"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker compose -f deploy/nmstest.compose.yml up -d postgres redis guacamole-db guacd vnc-proxy traefik"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && until docker compose -f deploy/nmstest.compose.yml exec -T guacamole-db pg_isready -U guacamole -d guacamole_db >/dev/null 2>&1; do sleep 2; done"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker run --rm guacamole/guacamole /opt/guacamole/bin/initdb.sh --postgresql | docker compose -f deploy/nmstest.compose.yml exec -T guacamole-db psql -h 127.0.0.1 -U guacamole -d guacamole_db"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker compose -f deploy/nmstest.compose.yml up -d --build"

log "Applying database migrations and bootstrapping admin"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker compose -f deploy/nmstest.compose.yml exec -T postgres pg_isready -U postgres -d nms_vpn"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker run --rm --network host --env-file .env.deploy -v '$REMOTE_APP_DIR:/repo' -w /repo node:22-alpine sh -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm --filter @nms/db db:migrate && pnpm db:bootstrap-admin'"

log "Restarting app after migrations"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker compose -f deploy/nmstest.compose.yml up -d"

log "Remote status"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_APP_DIR' && docker compose -f deploy/nmstest.compose.yml ps && wg show wg0"

cat <<EOF

Deployment complete.

Open:
  https://${APP_HOSTNAME}
  https://${GUAC_HOSTNAME}

Login:
  Use ADMIN_EMAIL and ADMIN_PASSWORD from your local .env.
  If they were not set, this script generated a password and wrote it to .env.deploy on the remote host.

If DNS is not ready yet, add a temporary local hosts entry for the VM IP:
  <VM_IP> ${APP_HOSTNAME}
EOF

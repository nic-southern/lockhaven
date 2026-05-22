#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_FILE="${ROOT_DIR}/.env.stage"
DEPLOY_ENV_FILE="${ROOT_DIR}/.env.deploy"
TF_DIR="${ROOT_DIR}/infra/terraform"
TFVARS_FILE="${TF_DIR}/terraform.tfvars"
PROVIDER_FILE="${TF_DIR}/provider.tf"

log() {
  printf '\n==> %s\n' "$*"
}

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_file "$STAGE_FILE"

set -a
. "$STAGE_FILE"
set +a

if [ -z "${TF_VAR_do_token:-}" ] && [ -n "${DO_TOKEN:-}" ]; then
  export TF_VAR_do_token="$DO_TOKEN"
fi
: "${TF_VAR_do_token:?Set TF_VAR_do_token or DO_TOKEN before running the script}"
: "${GHCR_USER:?Set GHCR_USER in .env.stage}"
: "${GHCR_READ_TOKEN:?Set GHCR_READ_TOKEN in .env.stage or export it in your shell}"
DEPLOY_ONLY="${DEPLOY_ONLY:-0}"

repo_slug="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [ -z "${repo_slug:-}" ]; then
  repo_url="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
  repo_slug="${repo_url#*github.com/}"
  repo_slug="${repo_slug##*:}"
  repo_slug="${repo_slug%.git}"
fi
if [ -z "${repo_slug:-}" ] || [ "$repo_slug" = "${repo_url:-}" ]; then
  repo_slug="your-org/your-repo"
fi
repo_slug="${repo_slug%.git}"

repo_owner="${repo_slug%%/*}"
web_image="${WEB_IMAGE:-ghcr.io/${repo_owner}/lockhaven-web:main}"
worker_image="${WORKER_IMAGE:-ghcr.io/${repo_owner}/lockhaven-worker:main}"

require_file "${TF_DIR}/provider.tf.example"

if [ "$DEPLOY_ONLY" != "1" ]; then
  cp "${TF_DIR}/provider.tf.example" "$PROVIDER_FILE"

  log "Generating Terraform variables"
  read -r -a ssh_allowed_cidrs_array <<< "${SSH_ALLOWED_CIDRS:-0.0.0.0/0 ::/0}"
  {
    printf 'name = "%s"\n' "${NAME:-management-vpn-prod}"
    printf 'environment = "%s"\n' "${ENVIRONMENT:-prod}"
    printf 'region = "%s"\n' "${REGION:-nyc3}"
    printf 'droplet_size = "%s"\n' "${DROPLET_SIZE:-s-2vcpu-4gb}"
    printf 'image = "%s"\n' "${IMAGE:-ubuntu-24-04-x64}"
    printf 'ssh_key_name = "%s"\n' "${SSH_KEY_NAME:?Set SSH_KEY_NAME in .env.stage}"
    printf 'ssh_allowed_cidrs = ['
    for i in "${!ssh_allowed_cidrs_array[@]}"; do
      [ "$i" -gt 0 ] && printf ', '
      printf '"%s"' "${ssh_allowed_cidrs_array[$i]}"
    done
    printf ']\n'
  } > "$TFVARS_FILE"
else
  log "Skipping Terraform; using the existing droplet"
fi

log "Generating deploy environment"
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  admin_password="$ADMIN_PASSWORD"
  admin_password_generated=0
else
  admin_password="$(openssl rand -hex 16)"
  admin_password_generated=1
fi
postgres_password="${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"
guacamole_db_password="${GUACAMOLE_DB_PASSWORD:-$(openssl rand -hex 16)}"
better_auth_secret="${BETTER_AUTH_SECRET:-$(openssl rand -hex 32)}"
remote_credentials_key="${REMOTE_CREDENTIALS_KEY:-$(openssl rand -hex 32)}"

cat > "$DEPLOY_ENV_FILE" <<EOF
APP_ENV=production
APP_BASE_URL=https://${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
BETTER_AUTH_URL=https://${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
NEXTAUTH_URL=https://${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
NEXT_PUBLIC_APP_URL=https://${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
PRODUCT_NAME=${PRODUCT_NAME:-Lockhaven}
ROOT_DOMAIN=${ROOT_DOMAIN:-example.com}
APP_HOSTNAME=${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
GUAC_HOSTNAME=${GUAC_HOSTNAME:?Set GUAC_HOSTNAME in .env.stage}
ACME_EMAIL=${ACME_EMAIL:?Set ACME_EMAIL in .env.stage}
GUACAMOLE_BASE_URL=https://${GUAC_HOSTNAME:?Set GUAC_HOSTNAME in .env.stage}/guacamole/
GUACAMOLE_DATABASE_URL=postgresql://guacamole:${guacamole_db_password}@guacamole-db:5432/guacamole_db
GUACAMOLE_API_SESSION_TIMEOUT=${GUACAMOLE_API_SESSION_TIMEOUT:-1440}
DATABASE_URL=postgresql://postgres:${postgres_password}@127.0.0.1:5432/nms_vpn
REDIS_URL=redis://127.0.0.1:6379/0
VPN_PUBLIC_HOSTNAME=${VPN_PUBLIC_HOSTNAME:?Set VPN_PUBLIC_HOSTNAME in .env.stage}
VPN_PUBLIC_PORT=51820
VPN_SERVER_IP=10.80.0.1
VPN_SERVER_PUBLIC_KEY=${VPN_SERVER_PUBLIC_KEY:-}
VPN_DEFAULT_ALLOWED_IPS=10.80.0.1/32
SOC_BASE_URL=${SOC_BASE_URL:-}
WIREGUARD_INTERFACE=wg0
VPNCTL_PATH=/usr/local/sbin/vpnctl
REMOTE_ACCESS_PROVIDER=guacamole
POSTGRES_PASSWORD=${postgres_password}
GUACAMOLE_DB_PASSWORD=${guacamole_db_password}
BETTER_AUTH_SECRET=${better_auth_secret}
REMOTE_CREDENTIALS_KEY=${remote_credentials_key}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
ADMIN_PASSWORD=${admin_password}
ADMIN_NAME=${ADMIN_NAME:-Admin}
ADMIN_ROLE=${ADMIN_ROLE:-owner}
WEB_IMAGE=${web_image}
WORKER_IMAGE=${worker_image}
EOF

chmod 600 "$DEPLOY_ENV_FILE"

if [ "$DEPLOY_ONLY" != "1" ]; then
  log "Applying Terraform"
  (
    cd "$TF_DIR"
    terraform init
    terraform apply -auto-approve
  )

  droplet_ip="$(cd "$TF_DIR" && terraform output -raw droplet_ipv4_address)"
else
  : "${DEPLOY_HOST:?Set DEPLOY_HOST when DEPLOY_ONLY=1}"
  droplet_ip="${DEPLOY_HOST#root@}"
fi
ssh_host="${SSH_HOST:-root@${droplet_ip}}"
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
printf -v ghcr_user_quoted "%q" "$GHCR_USER"

log "Copying deployment files to ${ssh_host}"
ssh "${ssh_opts[@]}" "$ssh_host" "mkdir -p /opt/lockhaven/deploy"
scp "${ssh_opts[@]}" "$ROOT_DIR/deploy/production.compose.yml" "$ssh_host:/opt/lockhaven/deploy/production.compose.yml"
scp "${ssh_opts[@]}" "$DEPLOY_ENV_FILE" "$ssh_host:/opt/lockhaven/.env.deploy"
scp "${ssh_opts[@]}" "$ROOT_DIR/infra/systemd/vpnctl" "$ssh_host:/tmp/vpnctl"
ssh "${ssh_opts[@]}" "$ssh_host" "install -m 0755 /tmp/vpnctl /usr/local/sbin/vpnctl && chmod 600 /opt/lockhaven/.env.deploy"

log "Preparing Docker on ${ssh_host}"
ssh "${ssh_opts[@]}" "$ssh_host" "set -euo pipefail
  if command -v cloud-init >/dev/null 2>&1; then
    cloud-init status --wait
  fi

  for _ in \$(seq 1 120); do
    command -v docker >/dev/null 2>&1 && break
    sleep 5
  done

  command -v docker

  for _ in \$(seq 1 60); do
    docker compose version >/dev/null 2>&1 && break
    sleep 5
  done
  docker compose version

  systemctl start docker >/dev/null 2>&1 || true

  for _ in \$(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 5
  done
  docker info >/dev/null
"

log "Preparing WireGuard on ${ssh_host}"
vpn_server_public_key="$(ssh "${ssh_opts[@]}" "$ssh_host" "set -euo pipefail
  if ! command -v wg >/dev/null 2>&1 || ! command -v wg-quick >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update >/dev/null
    apt-get install -y wireguard-tools >/dev/null
  fi

  install -d -m 0700 /etc/wireguard
  private_key_path=/etc/wireguard/server-private.key
  public_key_path=/etc/wireguard/server-public.key

  if [ ! -s \"\$private_key_path\" ]; then
    wg genkey > \"\$private_key_path\"
  fi

  chmod 0600 \"\$private_key_path\"
  private_key=\$(cat \"\$private_key_path\")
  public_key=\$(printf '%s' \"\$private_key\" | wg pubkey)
  printf '%s\n' \"\$public_key\" > \"\$public_key_path\"
  chmod 0644 \"\$public_key_path\"

  cat > /etc/wireguard/wg0.conf <<EOF_WG
[Interface]
Address = 10.80.0.1/16
ListenPort = 51820
PrivateKey = \$private_key
SaveConfig = false
EOF_WG
  chmod 0600 /etc/wireguard/wg0.conf

  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  printf '%s\n' 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-lockhaven-wireguard.conf

  if systemctl is-active --quiet wg-quick@wg0; then
    systemctl restart wg-quick@wg0
  else
    systemctl enable --now wg-quick@wg0 >/dev/null
  fi

  printf '%s\n' \"\$public_key\"
")"

if grep -q '^VPN_SERVER_PUBLIC_KEY=' "$DEPLOY_ENV_FILE"; then
  sed -i.bak "s|^VPN_SERVER_PUBLIC_KEY=.*|VPN_SERVER_PUBLIC_KEY=${vpn_server_public_key}|" "$DEPLOY_ENV_FILE"
  rm -f "${DEPLOY_ENV_FILE}.bak"
else
  printf 'VPN_SERVER_PUBLIC_KEY=%s\n' "$vpn_server_public_key" >> "$DEPLOY_ENV_FILE"
fi
scp "${ssh_opts[@]}" "$DEPLOY_ENV_FILE" "$ssh_host:/opt/lockhaven/.env.deploy"
ssh "${ssh_opts[@]}" "$ssh_host" "chmod 600 /opt/lockhaven/.env.deploy"

log "Logging in to GHCR on ${ssh_host}"
printf '%s\n' "$GHCR_READ_TOKEN" | ssh "${ssh_opts[@]}" "$ssh_host" "docker login ghcr.io -u ${ghcr_user_quoted} --password-stdin"

log "Starting the stack on ${ssh_host}"
ssh "${ssh_opts[@]}" "$ssh_host" "set -euo pipefail
  cd /opt/lockhaven
  docker compose --env-file .env.deploy -f deploy/production.compose.yml pull
  docker compose --env-file .env.deploy -f deploy/production.compose.yml up -d postgres redis guacamole-db guacd traefik

  for _ in \$(seq 1 60); do
    docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d nms_vpn && break
    sleep 2
  done
  docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d nms_vpn

  for _ in \$(seq 1 60); do
    docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T redis redis-cli ping && break
    sleep 2
  done
  docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T redis redis-cli ping

  docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T postgres sh -lc 'printf \"ALTER USER postgres PASSWORD '\\''%s'\\'';\\n\" \"\$POSTGRES_PASSWORD\" | psql -U postgres -d postgres'
  docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T guacamole-db sh -lc 'printf \"ALTER USER guacamole PASSWORD '\\''%s'\\'';\\n\" \"\$POSTGRES_PASSWORD\" | psql -U guacamole -d guacamole_db'

  if ! docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T guacamole-db psql -U guacamole -d guacamole_db -tAc \"select to_regclass('public.guacamole_connection')\" | grep -q guacamole_connection; then
    docker compose --env-file .env.deploy -f deploy/production.compose.yml run --rm --no-deps --entrypoint /opt/guacamole/bin/initdb.sh guacamole --postgresql | docker compose --env-file .env.deploy -f deploy/production.compose.yml exec -T guacamole-db psql -U guacamole -d guacamole_db
  fi
"

log "Applying database migrations and bootstrapping admin"
ssh "${ssh_opts[@]}" "$ssh_host" "set -euo pipefail
  cd /opt/lockhaven
  docker compose --env-file .env.deploy -f deploy/production.compose.yml run --rm migrate
"

log "Starting application services on ${ssh_host}"
ssh "${ssh_opts[@]}" "$ssh_host" "set -euo pipefail
  cd /opt/lockhaven
  docker compose --env-file .env.deploy -f deploy/production.compose.yml up -d --remove-orphans
"

cat <<EOF

Deployment complete.

Admin user:
  ${ADMIN_EMAIL:-admin@example.com}
EOF

if [ "$admin_password_generated" = "1" ]; then
  cat <<EOF

Generated admin password:
  ${admin_password}
EOF
else
  cat <<EOF

Admin password:
  using ADMIN_PASSWORD from ${STAGE_FILE}
EOF
fi

cat <<EOF

Open:
  https://${APP_HOSTNAME}
  https://${GUAC_HOSTNAME}

If DNS is still propagating, point those hostnames at ${droplet_ip} temporarily.
EOF

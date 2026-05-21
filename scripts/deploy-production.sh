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
: "${GHCR_READ_TOKEN:?Set GHCR_READ_TOKEN in .env.stage}"
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

web_image="${WEB_IMAGE:-ghcr.io/${repo_slug}/web:main}"
worker_image="${WORKER_IMAGE:-ghcr.io/${repo_slug}/worker:main}"

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
admin_password="${ADMIN_PASSWORD:-$(openssl rand -hex 16)}"
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
ROOT_DOMAIN=${ROOT_DOMAIN:-example.com}
APP_HOSTNAME=${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
GUAC_HOSTNAME=${GUAC_HOSTNAME:?Set GUAC_HOSTNAME in .env.stage}
VNC_HOSTNAME=${VNC_HOSTNAME:?Set VNC_HOSTNAME in .env.stage}
VNC_PROXY_TARGET_HOST=${VNC_PROXY_TARGET_HOST:?Set VNC_PROXY_TARGET_HOST in .env.stage}
VNC_PROXY_TARGET_PORT=${VNC_PROXY_TARGET_PORT:?Set VNC_PROXY_TARGET_PORT in .env.stage}
VNC_PROXY_LISTEN_PORT=${VNC_PROXY_LISTEN_PORT:?Set VNC_PROXY_LISTEN_PORT in .env.stage}
GUACAMOLE_BASE_URL=https://${GUAC_HOSTNAME:?Set GUAC_HOSTNAME in .env.stage}/guacamole/
GUACAMOLE_DATABASE_URL=postgresql://guacamole:${guacamole_db_password}@guacamole-db:5432/guacamole_db
DATABASE_URL=postgresql://postgres:${postgres_password}@127.0.0.1:5432/nms_vpn
REDIS_URL=redis://127.0.0.1:6379/0
VPN_PUBLIC_HOSTNAME=${APP_HOSTNAME:?Set APP_HOSTNAME in .env.stage}
VPN_PUBLIC_PORT=51820
VPN_SERVER_IP=10.80.0.1
VPN_DEFAULT_ALLOWED_IPS=10.80.0.1/32
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

log "Starting the stack on the new droplet"
ssh "${ssh_opts[@]}" "$ssh_host" "set -euo pipefail
  until command -v docker >/dev/null 2>&1; do
    sleep 5
  done
  for _ in \$(seq 1 60); do
    docker compose version >/dev/null 2>&1 && break
    sleep 5
  done
  docker compose version >/dev/null 2>&1
  systemctl start docker >/dev/null 2>&1 || true
  for _ in \$(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 5
  done
  docker info >/dev/null 2>&1
  printf '%s\n' '${GHCR_READ_TOKEN}' | docker login ghcr.io -u '${GHCR_USER}' --password-stdin
  cd /opt/newmarketsecurity
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout /etc/traefik/certs/${APP_HOSTNAME}.key \
    -out /etc/traefik/certs/${APP_HOSTNAME}.crt \
    -subj /CN=${APP_HOSTNAME} \
    -addext subjectAltName=DNS:${APP_HOSTNAME},DNS:*.${APP_HOSTNAME},DNS:${GUAC_HOSTNAME}
  chmod 600 /etc/traefik/certs/${APP_HOSTNAME}.key
  chmod 644 /etc/traefik/certs/${APP_HOSTNAME}.crt
  cat > /etc/traefik/dynamic/tls.yml <<'EOF'
tls:
  certificates:
    - certFile: /etc/traefik/certs/${APP_HOSTNAME}.crt
      keyFile: /etc/traefik/certs/${APP_HOSTNAME}.key
EOF
  docker compose --env-file .env.deploy -f deploy/production.compose.yml pull
  docker compose --env-file .env.deploy -f deploy/production.compose.yml up -d --remove-orphans
"

cat <<EOF

Deployment complete.

Open:
  https://${APP_HOSTNAME}
  https://${GUAC_HOSTNAME}

If DNS is still propagating, point those hostnames at ${droplet_ip} temporarily.
EOF

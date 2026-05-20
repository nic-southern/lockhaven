# Management VPN Workspace

This repository contains a TypeScript monorepo for the management VPN and
device inventory platform.

## Commands

- `pnpm install`
- `pnpm dev:web`
- `pnpm dev:worker`
- `pnpm test`
- `pnpm format:check`
- `ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='set-a-password' pnpm db:bootstrap-admin`
- `pnpm --filter @nms/db db:migrate`
- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`

## Layout

- `apps/web` - dashboard, session UI, tRPC route handlers, and device endpoints.
- `apps/worker` - WireGuard reconciliation and health jobs.
- `packages/*` - shared domain, DB, auth, VPN, and remote-access code.
- `infra/cloud-init` - droplet bootstrap settings.
- `infra/terraform` - droplet provisioning with Terraform.
- `deploy/` - lab and production compose files.
- `scripts/` - deployment helpers.

## Secret Setup

Copy `/.env.example` to `/.env`, then generate the placeholders shown there:

- `openssl rand -hex 16` for `POSTGRES_PASSWORD`, `GUACAMOLE_DB_PASSWORD`, and `ADMIN_PASSWORD`
- `openssl rand -hex 32` for `REMOTE_CREDENTIALS_KEY` and `BETTER_AUTH_SECRET`
- `wg genkey | tee server_private.key | wg pubkey > server_public.key` for `VPN_SERVER_PUBLIC_KEY`

If you use `scripts/deploy-nmstest.sh`, it can also generate missing admin and database secrets during bootstrap.

## New Droplet

1. Create an Ubuntu 24.04 droplet and attach your SSH key.
2. Pass `infra/cloud-init/user-data.yaml` as cloud-init if your provider supports it.
3. Copy `infra/terraform/provider.tf.example` to `infra/terraform/provider.tf`.
4. Copy `infra/terraform/terraform.tfvars.example` to `infra/terraform/terraform.tfvars` and fill in the values.
5. Copy `/.env.example` to `/.env` and fill in the generated secrets.
6. Use `pnpm install` and `pnpm build` locally, or run `scripts/deploy-nmstest.sh` for the lab path.
7. For production, push containers through CI, then run `docker compose -f deploy/production.compose.yml up -d` on the droplet with a populated `.env.deploy`.

## CI/CD Pre-Flight

Set these GitHub Actions secrets before you can deploy:

- `DEPLOY_HOST` - the droplet hostname or IP
- `DEPLOY_USER` - the SSH user on the droplet
- `DEPLOY_SSH_KEY` - the private key used by the deploy workflow
- `GHCR_READ_TOKEN` - a GitHub token with `read:packages` so the droplet can pull images
- `TF_VAR_do_token` or a `do_token` variable passed to Terraform

The droplet itself should have `/opt/newmarketsecurity/.env.deploy` with the generated runtime values from `/.env.example`, including:

- `APP_HOSTNAME`, `GUAC_HOSTNAME`, and `VNC_HOSTNAME`
- `POSTGRES_PASSWORD` and `GUACAMOLE_DB_PASSWORD`
- `BETTER_AUTH_SECRET` and `REMOTE_CREDENTIALS_KEY`
- `VPN_SERVER_PUBLIC_KEY`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`

If you want to pull images manually from the droplet outside the workflow, use a GitHub token with `read:packages` and `repo` access for your account or machine user.

## Terraform Pre-Flight

Before `terraform init`, make sure you have:

- a DigitalOcean personal access token with droplet/firewall/DNS permissions
- the name of an SSH key already uploaded to DigitalOcean, matching `ssh_key_name`
- a local `provider.tf` copied from `infra/terraform/provider.tf.example`
- a filled `terraform.tfvars` copied from `infra/terraform/terraform.tfvars.example`

Then run:

```bash
cd infra/terraform
terraform init
terraform plan
terraform apply
```

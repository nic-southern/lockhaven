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

1. Copy `/.env.example` to `/.env` and generate the secret placeholders there.
2. Edit `/.env.stage` with the values that vary by environment, especially hostnames and droplet settings.
3. Copy `infra/terraform/provider.tf.example` to `infra/terraform/provider.tf`.
4. Put `DO_TOKEN` in `/.env.stage` or export `TF_VAR_do_token`, then run `scripts/deploy-production.sh`.
5. That script writes `infra/terraform/terraform.tfvars`, generates `.env.deploy`, provisions the droplet, copies the production compose file, and starts the stack.
6. For the lab path, use `scripts/deploy-nmstest.sh` instead.

`/.env.stage` can also hold bootstrap-only values such as `GHCR_USER` and `GHCR_READ_TOKEN`; the script uses them to log in before pulling images, but they are not copied into the droplet's `.env.deploy`.

If you need to find the right values:

- `GHCR_USER` is your GitHub username or the machine user that owns the package token.
- `GHCR_READ_TOKEN` should be a token with `read:packages` access.
- `SSH_KEY_NAME` must match an SSH key already uploaded to DigitalOcean.
- `DO_TOKEN` can live in `/.env.stage`; it is your DigitalOcean API token.
- `TF_VAR_do_token` is the same token exported in your shell instead of the stage file.

The droplet bootstrap now installs Docker from Docker's apt repository and uses `iptables` rules in the `DOCKER-USER` chain for host access control.

If you want to rerun the bootstrap on an existing droplet without touching Terraform, set `DEPLOY_ONLY=1` and provide `DEPLOY_HOST`.

## CI/CD Pre-Flight

Set these GitHub Actions secrets before you can deploy:

- `DEPLOY_HOST` - the droplet hostname or IP
- `DEPLOY_USER` - the SSH user on the droplet
- `DEPLOY_SSH_KEY` - the private key used by the deploy workflow
- `GHCR_READ_TOKEN` - a GitHub token with `read:packages` so the droplet can pull images
- `TF_VAR_do_token` or a `do_token` variable passed to Terraform

The droplet itself should have `/opt/newmarketsecurity/.env.deploy` with the generated runtime values from `/.env.example`, including:

- `APP_HOSTNAME` and `GUAC_HOSTNAME`
- `POSTGRES_PASSWORD` and `GUACAMOLE_DB_PASSWORD`
- `BETTER_AUTH_SECRET` and `REMOTE_CREDENTIALS_KEY`
- `VPN_SERVER_PUBLIC_KEY`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`

If you want to pull images manually from the droplet outside the workflow, use a GitHub token with `read:packages` and `repo` access for your account or machine user.

## Terraform Pre-Flight

Before `terraform init`, make sure you have:

- a DigitalOcean personal access token with droplet/firewall/DNS permissions
- the name of an SSH key already uploaded to DigitalOcean, matching `ssh_key_name`
- the matching private key loaded in your SSH agent for the Terraform file copies
- a local `provider.tf` copied from `infra/terraform/provider.tf.example`
- a staged root file at `/.env.stage`
- either `TF_VAR_do_token` or `DO_TOKEN` exported in your shell

Then run the production bootstrap script:

```bash
scripts/deploy-production.sh
```

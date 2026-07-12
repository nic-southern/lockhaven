# Deployment

## Local Development

- Use `pnpm install`.
- Start Postgres and Redis locally with Docker Compose.
- Use `DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/nms_vpn`.

## Production Deploy

Lockhaven has two production deployment paths, plus optional auto-deploy from
GitHub Actions after images publish to GHCR.

### Auto-deploy from GitHub Actions

On every successful `main` push, CI publishes `lockhaven-web` and
`lockhaven-worker` to GHCR. When auto-deploy is enabled, a follow-up job SSHs
to the production host, syncs `deploy/production.compose.yml`, pulls the new
images, runs migrations, and restarts the stack via
[`scripts/remote-compose-update.sh`](../scripts/remote-compose-update.sh).

Enable it once:

1. Create a dedicated SSH key for deploys (do not reuse a personal laptop key
   if you can avoid it).
2. Install the public key in `authorized_keys` for the deploy user on the
   droplet (default user is `root`).
3. In the GitHub repository settings, add secrets:
   - `DEPLOY_HOST` — droplet IP or hostname (for example `159.89.33.148`)
   - `DEPLOY_SSH_PRIVATE_KEY` — the matching private key
   - `DEPLOY_SSH_USER` — optional; defaults to `root`
4. Add repository variable `AUTO_DEPLOY` with value `true`.

Until `AUTO_DEPLOY=true`, publish still runs but the deploy job is skipped.
Manual updates remain available with
`DEPLOY_ONLY=1 DEPLOY_HOST=<ip> bash scripts/deploy-production.sh`.

### Terraform Deploy

Use this path when Lockhaven should provision and bootstrap the production host.
The default Terraform provider config targets DigitalOcean.

- Copy `/.env.stage.example` to `/.env.stage`.
- Edit `/.env.stage` with hostnames, droplet settings, image pull credentials,
  admin credentials, and `PRODUCT_NAME`.
- Copy `infra/terraform/provider.tf.example` to
  `infra/terraform/provider.tf`; change it only if you are adapting the
  Terraform path away from the default DigitalOcean setup.
- Set `DO_TOKEN` in `/.env.stage` or export `TF_VAR_do_token`.
- Run [`scripts/deploy-production.sh`](../scripts/deploy-production.sh).

The script generates `.env.deploy` from `/.env.stage`, provisions the droplet,
copies the production Compose file, starts the stack, runs migrations, and
refreshes the admin user.

### DIY Existing Host

Use this path when Docker and Docker Compose already exist on the host. The full
repository does not need to be cloned onto the server.

Create this layout on the host:

```text
/opt/lockhaven/
  .env.deploy
  deploy/
    production.compose.yml
  scripts/
    remote-compose-update.sh
```

Copy [`deploy/production.compose.yml`](../deploy/production.compose.yml) into
the `deploy` directory, then create `.env.deploy` beside it. Start from
`/.env.example`, set `APP_ENV=production`, and include production values for
hostnames, secrets, database passwords, admin credentials, `PRODUCT_NAME`,
`WEB_IMAGE`, and `WORKER_IMAGE`.

You can use the published Lockhaven images directly; build and publish your own
images only when customizing the app. Point `WEB_IMAGE` and `WORKER_IMAGE` at
the desired `ghcr.io/nic-southern/lockhaven-*:<tag>` images.

Then run:

```bash
cd /opt/lockhaven
bash scripts/remote-compose-update.sh
```

Or the equivalent Compose commands:

```bash
cd /opt/lockhaven
docker compose --env-file .env.deploy -f deploy/production.compose.yml pull
docker compose --env-file .env.deploy -f deploy/production.compose.yml up -d --remove-orphans
docker compose --env-file .env.deploy -f deploy/production.compose.yml run --rm migrate
```

### Production Expectations

- Use the published Lockhaven images, or build and push your own customized web
  and worker images.
- Prefer auto-deploy from GitHub Actions after `main` publishes, or pull and
  restart Docker Compose manually.
- Run database migrations through the worker image after each deploy.
- Keep Postgres, Redis, and Guacamole on private Docker networks.
- Keep domain names configurable through environment variables.
- Manage host firewall rules with `iptables` in the `DOCKER-USER` chain, not a
  standalone `nftables` ruleset.

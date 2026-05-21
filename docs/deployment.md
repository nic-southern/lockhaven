# Deployment

## Local Development

- Use `pnpm install`.
- Start Postgres and Redis locally with Docker Compose.
- Use `DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/nms_vpn`.

## Production Deploy

Lockhaven has two production deployment paths.

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
docker compose --env-file .env.deploy -f deploy/production.compose.yml pull
docker compose --env-file .env.deploy -f deploy/production.compose.yml up -d --remove-orphans
docker compose --env-file .env.deploy -f deploy/production.compose.yml run --rm --no-deps worker sh -lc 'cd /repo/packages/db && ./node_modules/.bin/drizzle-kit migrate --config ./drizzle.config.ts && node scripts/bootstrap-admin.mjs'
```

### Production Expectations

- Use the published Lockhaven images, or build and push your own customized web
  and worker images.
- Pull pinned SHA tags on deploy and restart Docker Compose.
- Run database migrations and refresh the admin account through the worker
  image after each deploy.
- Keep Postgres, Redis, and Guacamole on private Docker networks.
- Keep domain names configurable through environment variables.
- Manage host firewall rules with `iptables` in the `DOCKER-USER` chain, not a
  standalone `nftables` ruleset.

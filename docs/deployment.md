# Deployment

## Local Development

- Use `pnpm install`.
- Start Postgres and Redis locally with Docker Compose.
- Use `DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/nms_vpn`.

## Lab Deploy

- Use [`scripts/deploy-nmstest.sh`](../scripts/deploy-nmstest.sh) to provision a
  test droplet.
- The lab stack is defined in
  [`deploy/nmstest.compose.yml`](../deploy/nmstest.compose.yml).
- The web and worker containers are built on the host for this environment.
- If `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, or `GUACAMOLE_DB_PASSWORD` are
  missing, the deploy script generates them during bootstrap.
- See [`docs/infrastructure.md`](infrastructure.md) for the droplet setup
  checklist.

## Production Deploy

- Provision the droplet with [`infra/terraform`](../infra/terraform/README.md).
- Build web and worker containers in GitHub Actions.
- Push the images to GitHub Container Registry.
- Use [`deploy/production.compose.yml`](../deploy/production.compose.yml) on the
  droplet.
- Provide a populated `.env.deploy` on the host before running the workflow.
- Pull pinned SHA tags on deploy and restart Docker Compose.
- Keep Postgres, Redis, and Guacamole on private Docker networks.
- Keep domain names configurable through environment variables.
- Manage host firewall rules with `iptables` in the `DOCKER-USER` chain, not a
  standalone `nftables` ruleset.

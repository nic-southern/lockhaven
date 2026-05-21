# Infrastructure

## Droplet Bootstrap

- Use Ubuntu 24.04 on a fresh droplet.
- Attach your SSH key during creation.
- If your provider supports it, pass `infra/cloud-init/user-data.yaml` as
  cloud-init so Docker, WireGuard, `iptables-persistent`, and openssl are
  installed.
- Docker's host rules should live in the `DOCKER-USER` chain so container
  networking stays under Docker's control.

## Lab Deploy

1. Clone the repository onto the droplet.
2. Copy `/.env.example` to `/.env`.
3. Generate the secrets shown in `/.env.example`.
4. Run `scripts/deploy-nmstest.sh` from a workstation with SSH access to the
   droplet.

## Production Deploy

1. Provision a droplet and configure DNS for the app and Guacamole hostnames.
2. Populate `.env.deploy` with the production values and generated secrets.
3. Run `docker compose --env-file .env.deploy -f deploy/production.compose.yml up -d`
   on the droplet.
4. Let GitHub Actions publish `web` and `worker` images to GitHub Container
   Registry, then deploy pinned SHA tags with the workflow in `.github/workflows/deploy.yml`.

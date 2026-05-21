# Infrastructure

## Droplet Bootstrap

- Use Ubuntu 24.04 on a fresh droplet.
- Attach your SSH key during creation.
- If your provider supports it, pass `infra/cloud-init/user-data.yaml` as
  cloud-init so Docker, WireGuard, `iptables-persistent`, and openssl are
  installed.
- Docker's host rules should live in the `DOCKER-USER` chain so container
  networking stays under Docker's control.

## Production Deploy

Use one of two production paths:

1. Terraform deploy: populate `/.env.stage`, keep the default DigitalOcean
   provider config or adapt `infra/terraform/provider.tf`, then run
   `scripts/deploy-production.sh`.
2. DIY existing host: copy only `deploy/production.compose.yml` and a populated
   `.env.deploy` to the host, then run Docker Compose directly.

In both paths, configure DNS for the app and Guacamole hostnames, publish the
`web` and `worker` images to GitHub Container Registry, pull pinned image tags,
run migrations, and refresh the admin user after deploy.

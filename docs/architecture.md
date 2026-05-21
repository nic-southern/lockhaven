# Architecture

The system is a pnpm TypeScript monorepo with these layers:

- `apps/web` serves the dashboard, Better Auth routes, tRPC route handlers, and device endpoints.
- `apps/worker` runs reconciliation and health jobs.
- `packages/db` owns the schema and database access.
- `packages/auth` owns Better Auth config, session helpers, and permission checks.
- `packages/vpn` handles allocation and WireGuard command generation.
- `packages/remote-access` abstracts browser-launched remote sessions.

Production services run as Docker containers on a single DigitalOcean droplet.
The lab deploy uses Traefik for HTTPS routing. Production uses the same service
layout with pinned container images and private data services on the droplet.
The droplet bootstrap settings live in `infra/cloud-init/user-data.yaml`.
Host access rules are managed with `iptables` in Docker's `DOCKER-USER` chain so
Docker can keep control of container networking.
Droplet creation is defined in `infra/terraform/main.tf`.

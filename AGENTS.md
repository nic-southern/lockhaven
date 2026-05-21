# AGENTS.md

## Product Context

Lockhaven is a WireGuard-backed access platform for remote infrastructure. It
enrolls remote clients, maintains private connectivity, tracks device inventory,
and reaches services like VNC, SSH, SQL, and internal web apps without exposing
devices directly.

The intended suite is:

- `Lockhaven Hub` - control plane for organizations, sites, devices, policies,
  sessions, audit history, and admin access.
- `Lockhaven Agent` - endpoint enrollment and check-in client.
- `Lockhaven Console` - web UI for inventory, access, health, and operations.
- `Lockhaven Gateway` - private service access and policy enforcement.
- `Lockhaven Relay` - connectivity layer for constrained environments.

Current repo scope includes Hub, Console, Gateway-adjacent service launch flow,
WireGuard reconciliation worker, deployment automation, and shared packages.
The current public repository is
`https://github.com/nic-southern/lockhaven.git`.

## Working In This Repo

- Install dependencies with `pnpm install`.
- Run the web app with `pnpm dev:web`.
- Run the worker with `pnpm dev:worker`.
- Run tests with `pnpm test`.
- Check formatting with `pnpm format:check`.
- Build everything with `pnpm build`.
- Typecheck everything with `pnpm typecheck`.
- Lint everything with `pnpm lint`.
- Run database migrations with `pnpm --filter @nms/db db:migrate`.
- Bootstrap an admin with `pnpm db:bootstrap-admin`.

## Core Paths

- `apps/web` - Next.js Console, session UI, tRPC route handlers, auth routes,
  enrollment endpoints, and health checks.
- `apps/worker` - WireGuard reconciliation and service health jobs.
- `packages/shared` - Domain schemas and shared product types.
- `packages/db` - Database schema, migrations, and admin bootstrap script.
- `packages/auth` - Authentication, roles, and permission helpers.
- `packages/vpn` - WireGuard command builders and VPN state parsing.
- `packages/remote-access` - Remote service connection provisioning.
- `packages/api-contract` - tRPC router, procedures, and API schemas.
- `infra` - Cloud-init, Terraform, and systemd helpers.
- `deploy` - Production Docker Compose definition.
- `docs` - Architecture, deployment, enrollment, and safety docs.

## Naming And Branding

- Default product name is `Lockhaven`.
- `PRODUCT_NAME` controls customer-facing UI/auth naming for white-label
  deployments.
- Container image names are `lockhaven-web` and `lockhaven-worker`.
- Existing host paths still use `/opt/newmarketsecurity` for compatibility with
  current deployed servers.

## Deployment Notes

- `scripts/deploy-production.sh` generates `.env.deploy`, starts the production
  Compose stack, applies database migrations, and refreshes the admin user.
- Production deploys pull images from GHCR and require `GHCR_USER` plus
  `GHCR_READ_TOKEN` during bootstrap.

## Safety Rules

- Do not commit secrets, private keys, state files, or real inventory.
- Keep example values sanitized.
- Prefer shared schemas and helpers over ad hoc duplication.
- Preserve shipped/deployed compatibility unless the user explicitly asks to
  migrate it, especially host paths, database names, and image references.
- Public-facing copy should be neutral product language. Do not expose vendor,
  framework, database, or implementation details in UI strings.

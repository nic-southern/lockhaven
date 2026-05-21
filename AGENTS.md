# AGENTS.md

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

- `apps/web` - Next.js dashboard, session UI, tRPC route handlers, and device endpoints.
- `apps/worker` - Background reconciliation and health jobs.
- `packages/*` - Shared domain, DB, auth, VPN, and remote-access logic.
- `infra/cloud-init` - Droplet bootstrap settings.
- `deploy` - Lab and production compose definitions.
- `docs` - Architecture, deployment, enrollment, and safety docs.

## Safety Rules

- Do not commit secrets, private keys, state files, or real inventory.
- Keep example values sanitized.
- Prefer shared schemas and helpers over ad hoc duplication.

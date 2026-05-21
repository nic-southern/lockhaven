# Database

## Local Setup

- Start Postgres and Redis with `docker compose up -d`.
- Set `DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/nms_vpn`.
- Run `pnpm --filter @nms/db db:migrate` against the local database.

## Migration Workflow

- Keep migration filenames in a single numeric sequence.
- Generate new migrations with `pnpm --filter @nms/db db:generate`.
- Apply them with `pnpm --filter @nms/db db:migrate`.
- Rebuild the schema package after any migration changes with `pnpm build:packages`.

## Bootstrapping

- Create or refresh an admin user with `pnpm db:bootstrap-admin`.

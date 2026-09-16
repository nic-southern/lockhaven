# Database

## Local Setup

- Start Postgres and Redis with `docker compose up -d`.
- Set `DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/nms_vpn`.
- Run `pnpm --filter @nms/db db:migrate` against the local database.

## Migration Workflow

- Keep migration filenames in a single numeric sequence.
- Generate new migrations with `pnpm --filter @nms/db db:generate`.
- Apply them with `pnpm --filter @nms/db db:migrate`.
- Hub MSP work uses `0021`–`0039`. Client-agent telemetry uses `0040+`.
- Hub SSO is `0025_sso` (`organization_sso_settings`, `sso_provider`,
  `user.sso_mfa_trusted`).
- Hub reporting is `0026_reporting` (`device_uptime_daily`, `report_schedules`).
- Hub agent fleet is `0027_agent_fleet` (`agent_releases`, `device_commands`,
  organization and site `agent_channel`).
- Rebuild the schema package after any migration changes with `pnpm build:packages`.

## Bootstrapping

- Create or refresh an admin user with `pnpm db:bootstrap-admin`.

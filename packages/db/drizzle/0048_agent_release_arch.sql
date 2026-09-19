ALTER TABLE "agent_releases" DROP CONSTRAINT IF EXISTS "agent_releases_platform_check";--> statement-breakpoint
ALTER TABLE "agent_releases" ADD CONSTRAINT "agent_releases_platform_check" CHECK ("platform" IN ('linux-amd64', 'linux-arm64', 'windows-amd64', 'windows-arm64', 'linux', 'windows', 'macos', 'android', 'all'));

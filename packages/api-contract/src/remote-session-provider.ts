import {
  guacamoleConfigSchema,
  GuacamoleRemoteAccessProvider,
} from "@nms/remote-access"

let cached: GuacamoleRemoteAccessProvider | null = null

export function getRemoteAccessProvider() {
  if (cached) return cached

  cached = new GuacamoleRemoteAccessProvider(
    guacamoleConfigSchema.parse({
      baseUrl:
        process.env.GUACAMOLE_BASE_URL ?? "https://guac.example.com/guacamole/",
      databaseUrl:
        process.env.GUACAMOLE_DATABASE_URL ??
        "postgresql://guacamole:replace_me@guacamole-db:5432/guacamole_db",
      apiUrl: process.env.GUACAMOLE_API_URL || undefined,
      adminUser: process.env.GUACAMOLE_ADMIN_USER || undefined,
    })
  )
  return cached
}

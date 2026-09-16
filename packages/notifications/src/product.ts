export function getProductName(env: NodeJS.ProcessEnv = process.env) {
  const name = (env.PRODUCT_NAME ?? env.APP_NAME ?? "Lockhaven").trim()
  return name.length > 0 ? name : "Lockhaven"
}

export function getAppBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const raw =
    env.APP_BASE_URL ??
    env.BETTER_AUTH_URL ??
    env.NEXTAUTH_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  return raw.replace(/\/$/, "")
}

export function inviteAcceptUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}`
}

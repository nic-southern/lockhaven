import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { isAllowedFieldRedirectUri, issueFieldHandoff } from "@/lib/field-auth"
import { getServerProductName } from "@/lib/product-name"

function encodeNextPath(path: string) {
  return encodeURIComponent(path)
}

export default async function FieldAuthPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirect_uri?: string
    state?: string
  }>
}) {
  const params = await searchParams
  const redirectUri = params.redirect_uri?.trim() ?? ""
  const state = params.state?.trim() || null
  const productName = getServerProductName()

  if (!redirectUri || !isAllowedFieldRedirectUri(redirectUri)) {
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cannot continue
        </h1>
        <p className="text-sm text-muted-foreground">
          Open sign-in from the {productName} field app on this computer.
        </p>
      </main>
    )
  }

  const requestHeaders = await headers()
  const session = await auth.api.getSession({
    headers: requestHeaders,
  })

  const returnPath = `/field/auth?redirect_uri=${encodeURIComponent(redirectUri)}${
    state ? `&state=${encodeURIComponent(state)}` : ""
  }`

  if (!session?.user?.id) {
    redirect(`/sign-in?next=${encodeNextPath(returnPath)}`)
  }

  let code: string
  try {
    const issued = await issueFieldHandoff({
      userId: session.user.id,
      redirectUri,
      state,
    })
    code = issued.code
  } catch {
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cannot continue
        </h1>
        <p className="text-sm text-muted-foreground">
          We could not prepare a field session. Close this window and try again
          from the app.
        </p>
      </main>
    )
  }

  const target = new URL(redirectUri)
  target.searchParams.set("code", code)
  if (state) {
    target.searchParams.set("state", state)
  }

  redirect(target.toString())
}

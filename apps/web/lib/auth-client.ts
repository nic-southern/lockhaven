"use client"

import { passkeyClient } from "@better-auth/passkey/client"
import { twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // The sign-in page owns the second-factor step; nothing to do here.
      },
    }),
    passkeyClient(),
  ],
})

export const { signIn, signOut, useSession } = authClient

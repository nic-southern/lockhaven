import * as React from "react"

const subscribe = () => () => {}
const getSnapshot = () =>
  typeof window !== "undefined" && Boolean(window.PublicKeyCredential)
const getServerSnapshot = () => false

/** True when the browser exposes WebAuthn; false during server render. */
export function usePasskeySupport() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

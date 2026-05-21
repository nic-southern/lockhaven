export function buildWireGuardConfig(args: {
  privateKey: string
  address: string
  serverPublicKey: string
  endpoint: string
  allowedIps: string[]
  persistentKeepalive: number
}) {
  return [
    "[Interface]",
    `Address = ${args.address}`,
    `PrivateKey = ${args.privateKey}`,
    "",
    "[Peer]",
    `PublicKey = ${args.serverPublicKey}`,
    `Endpoint = ${args.endpoint}`,
    `AllowedIPs = ${args.allowedIps.join(", ")}`,
    `PersistentKeepalive = ${args.persistentKeepalive}`,
  ].join("\n")
}

export function downloadTextFile(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

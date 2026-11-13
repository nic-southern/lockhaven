"use client"

import { WireGuardConfigDialog } from "@/components/vpn/wireguard-config-dialog"

export function AdminVpnConfigDialog({
  open,
  filename,
  config,
  onOpenChange,
}: {
  open: boolean
  filename: string
  config: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <WireGuardConfigDialog
      open={open}
      filename={filename}
      config={config}
      onOpenChange={onOpenChange}
      title="Profile ready"
      description="Scan this QR code with WireGuard on your phone, or download the config. It is shown only once. If you are asked for a name, use 15 characters or fewer."
    />
  )
}

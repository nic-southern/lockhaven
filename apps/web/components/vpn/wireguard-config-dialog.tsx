"use client"

import { DownloadIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { downloadTextFile } from "@/lib/wireguard"

export function WireGuardConfigDialog({
  open,
  filename,
  config,
  onOpenChange,
  title = "Config ready",
  description = "Scan this QR code with WireGuard, or download the config. It is shown only once.",
}: {
  open: boolean
  filename: string
  config: string
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {config ? (
          <div className="mx-auto w-fit rounded-xl border border-border/80 bg-white p-4">
            <QRCodeSVG
              value={config}
              size={220}
              level="L"
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
              title="WireGuard QR code"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button
            disabled={!config || !filename}
            onClick={() => downloadTextFile(filename, config)}
          >
            <DownloadIcon />
            Download config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

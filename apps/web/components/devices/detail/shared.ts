"use client"

import * as React from "react"

import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"

export type DeviceDetail = NonNullable<RouterOutputs["devices"]["byId"]>
export type DeviceService = DeviceDetail["services"][number]

export const DEVICE_TABS = [
  "overview",
  "connect",
  "services",
  "network",
  "activity",
  "settings",
] as const

export type DeviceTab = (typeof DEVICE_TABS)[number]

export function isDeviceTab(value: string | null): value is DeviceTab {
  return value !== null && (DEVICE_TABS as readonly string[]).includes(value)
}

/** Invalidates every query that renders this device, in lists or on its page. */
export function useInvalidateDevice(deviceId: string) {
  const utils = trpc.useUtils()
  return React.useCallback(async () => {
    await Promise.all([
      utils.devices.byId.invalidate({ id: deviceId }),
      utils.devices.page.invalidate(),
      utils.devices.list.invalidate(),
      utils.devices.facets.invalidate(),
      utils.managementServices.list.invalidate(),
      utils.managementServices.page.invalidate(),
      utils.dashboard.summary.invalidate(),
      utils.audit.page.invalidate(),
    ])
  }, [utils, deviceId])
}

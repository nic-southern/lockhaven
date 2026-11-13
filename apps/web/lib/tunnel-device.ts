export function isTunnelOnlyDevice(device: {
  hasCheckInSecret?: boolean | null
  agentVersion?: string | null
}) {
  return !device.hasCheckInSecret && !device.agentVersion
}

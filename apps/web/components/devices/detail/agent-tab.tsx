"use client"

import * as React from "react"
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/dashboard/code-block"
import { CopyableText } from "@/components/dashboard/copyable-text"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { osFamilyLabel } from "@/lib/devices"
import {
  buildAgentDownloadUrl,
  buildLinuxInstallCommand,
} from "@/lib/enrollment-commands"
import { getClientVpnBaseUrl } from "@/lib/product-name"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

import { DefinitionList } from "./definition-list"
import { type DeviceDetail } from "./shared"

const ENROLLMENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isLinuxFamily(osFamily: string | null | undefined) {
  return (osFamily ?? "").toLowerCase() === "linux"
}

function architectureHint(architecture: string | null | undefined) {
  const value = (architecture ?? "").toLowerCase()
  if (value === "x86_64" || value === "amd64") {
    return "Intel or AMD"
  }
  if (value === "aarch64" || value === "arm64") {
    return "ARM"
  }
  return architecture
}

export function AgentTab({ device }: { device: DeviceDetail }) {
  const { can } = usePermissions()
  const canEnroll = can("device:enroll")
  const createToken = trpc.enrollmentTokens.create.useMutation()
  const [token, setToken] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const baseUrl = getClientVpnBaseUrl()
  const reporting = Boolean(device.agentVersion || device.lastSeenAt)
  const linuxCommand = token
    ? buildLinuxInstallCommand({
        token,
        baseUrl,
        deviceId: device.id,
      })
    : ""
  const amd64Url = buildAgentDownloadUrl({ baseUrl, arch: "amd64" })
  const arm64Url = buildAgentDownloadUrl({ baseUrl, arch: "arm64" })
  const archHint = architectureHint(device.architecture)

  async function handleCreate() {
    setError(null)
    try {
      const result = await createToken.mutateAsync({
        organizationId: device.organizationId,
        siteId: device.siteId ?? null,
        siteWide: false,
        maxUses: 1,
        expiresAt: device.siteId
          ? new Date(Date.now() + ENROLLMENT_TOKEN_TTL_MS)
          : null,
      })
      setToken(result.token)
      toast.success("Install command ready")
    } catch {
      setError("We couldn't create an install command.")
      toast.error("We couldn't create an install command.")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Status"
        description="Whether this device is checking in with an agent."
      >
        <DefinitionList
          columns={3}
          items={[
            {
              label: "Agent",
              value: (
                <StatusIndicator
                  tone={reporting ? "online" : "neutral"}
                  label={reporting ? "Reporting" : "Not reporting"}
                  pulse={reporting}
                />
              ),
            },
            {
              label: "Version",
              value: device.agentVersion,
              mono: true,
            },
            {
              label: "Last check-in",
              value: device.lastSeenAt ? (
                <span title={formatDate(device.lastSeenAt)}>
                  {formatRelativeTime(device.lastSeenAt)}
                </span>
              ) : (
                <span className="text-muted-foreground">Never</span>
              ),
            },
            {
              label: "Operating system",
              value: osFamilyLabel(device.osFamily),
            },
            {
              label: "Architecture",
              value: device.architecture,
              mono: true,
            },
            {
              label: "Device id",
              value: <CopyableText value={device.id} className="text-xs" />,
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Install on this device"
        description={
          reporting
            ? "Use this if you need to reinstall the agent. It stays attached to this listing."
            : "Install the agent on this machine. It joins this listing instead of creating a new one."
        }
      >
        {canEnroll ? (
          <div className="flex flex-col gap-4">
            {!isLinuxFamily(device.osFamily) && device.osFamily ? (
              <p className="text-sm text-muted-foreground">
                This device is recorded as {osFamilyLabel(device.osFamily)}. The
                agent installer currently supports Linux.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Create a command, then run it on the device. The listing id is
                included so install binds here even if the host name is shared.
              </p>
            )}
            <Button
              className="w-full sm:w-fit"
              onClick={() => void handleCreate()}
              disabled={createToken.isPending}
            >
              {createToken.isPending
                ? "Creating…"
                : token
                  ? "Create a new command"
                  : "Create install command"}
            </Button>
            {token ? (
              <CodeBlock label="Linux" value={linuxCommand} />
            ) : (
              <EmptyState
                title="No command yet"
                description="The install command appears after you create one."
                bordered
              />
            )}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You can download the agent below. Creating an install command needs
            enrollment access.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Download"
        description={
          archHint
            ? `Copy the agent onto the device if you cannot run the command above. This device reports ${archHint}.`
            : "Copy the agent onto the device if you cannot run the command above."
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={amd64Url}>
              <DownloadIcon />
              Linux (Intel or AMD)
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={arm64Url}>
              <DownloadIcon />
              Linux (ARM)
            </a>
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}

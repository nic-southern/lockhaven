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
  buildWindowsInstallCommand,
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

function isWindowsFamily(osFamily: string | null | undefined) {
  return (osFamily ?? "").toLowerCase() === "windows"
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

function observationSummary(payload: unknown) {
  if (!payload || typeof payload !== "object") return "—"
  const row = payload as {
    type?: string
    running?: boolean
    exists?: boolean
    value?: string
    bytes?: number
  }
  if (row.type === "process_running") {
    return row.running ? "Running" : "Not running"
  }
  if (row.type === "file_exists") {
    return row.exists ? "Present" : "Missing"
  }
  if (row.type === "file_text") {
    return row.exists ? (row.value ?? "—") : "Missing"
  }
  if (row.type === "file_size") {
    if (!row.exists) return "Missing"
    if (typeof row.bytes !== "number") return "—"
    return `${row.bytes.toLocaleString()} B`
  }
  return "—"
}

export function AgentTab({ device }: { device: DeviceDetail }) {
  const { can } = usePermissions()
  const canEnroll = can("device:enroll")
  const observationsQuery = trpc.agentModules.observations.useQuery(
    { deviceId: device.id },
    { enabled: can("device:view") }
  )
  const createToken = trpc.enrollmentTokens.create.useMutation()
  const [token, setToken] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const baseUrl = getClientVpnBaseUrl()
  const reporting = Boolean(device.agentVersion || device.lastSeenAt)
  const windowsDevice = isWindowsFamily(device.osFamily)
  const linuxDevice = isLinuxFamily(device.osFamily)
  const agentSupported = windowsDevice || linuxDevice || !device.osFamily
  const linuxCommand = token
    ? buildLinuxInstallCommand({
        token,
        baseUrl,
        deviceId: device.id,
      })
    : ""
  const windowsCommand = token
    ? buildWindowsInstallCommand({
        token,
        baseUrl,
        deviceId: device.id,
      })
    : ""
  const showLinuxDownloads = !windowsDevice
  const showWindowsDownloads = !linuxDevice
  const linuxAmd64Url = buildAgentDownloadUrl({ baseUrl, arch: "amd64" })
  const linuxArm64Url = buildAgentDownloadUrl({ baseUrl, arch: "arm64" })
  const windowsAmd64Url = buildAgentDownloadUrl({
    baseUrl,
    arch: "amd64",
    platform: "windows",
  })
  const windowsArm64Url = buildAgentDownloadUrl({
    baseUrl,
    arch: "arm64",
    platform: "windows",
  })
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
              label: "Current",
              value: device.agentVersion ?? "—",
              mono: Boolean(device.agentVersion),
            },
            {
              label: "Desired",
              value: device.desiredAgentVersion ?? "—",
              mono: Boolean(device.desiredAgentVersion),
            },
            {
              label: "Release",
              value: device.desiredAgentVersion ? (
                <StatusIndicator
                  tone={device.agentBehind ? "danger" : "online"}
                  label={device.agentBehind ? "Behind" : "Up to date"}
                />
              ) : (
                "—"
              ),
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

      {(observationsQuery.data?.length ?? 0) > 0 ? (
        <SectionCard
          title="Observations"
          description="Facts this device reported from assigned modules."
        >
          <DefinitionList
            columns={2}
            items={observationsQuery.data!.map((row) => ({
              label: `${row.moduleName} · ${row.collectorTypeLabel}`,
              value: (
                <span title={formatDate(row.lastSeenAt)}>
                  {observationSummary(row.payload)} ·{" "}
                  {formatRelativeTime(row.lastSeenAt)}
                </span>
              ),
            }))}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Install on this device"
        description={
          reporting
            ? "Use this if you need to reinstall the agent. It stays on this device."
            : "Install the agent on this machine. It attaches to this device instead of creating a new one."
        }
      >
        {canEnroll ? (
          <div className="flex flex-col gap-4">
            {!agentSupported ? (
              <p className="text-sm text-muted-foreground">
                This device is recorded as {osFamilyLabel(device.osFamily)}. The
                agent installer currently supports Linux and Windows.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Create a command, then run it on the device. It stays on this
                device even if another machine shares the same name.
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
              <div className="flex flex-col gap-3">
                {windowsDevice ? (
                  <CodeBlock label="Windows" value={windowsCommand} />
                ) : linuxDevice ? (
                  <CodeBlock label="Linux" value={linuxCommand} />
                ) : (
                  <>
                    <CodeBlock label="Linux" value={linuxCommand} />
                    <CodeBlock label="Windows" value={windowsCommand} />
                  </>
                )}
              </div>
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
          {showLinuxDownloads ? (
            <>
              <Button variant="outline" asChild>
                <a href={linuxAmd64Url}>
                  <DownloadIcon />
                  Linux (Intel or AMD)
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={linuxArm64Url}>
                  <DownloadIcon />
                  Linux (ARM)
                </a>
              </Button>
            </>
          ) : null}
          {showWindowsDownloads ? (
            <>
              <Button variant="outline" asChild>
                <a href={windowsAmd64Url}>
                  <DownloadIcon />
                  Windows (Intel or AMD)
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={windowsArm64Url}>
                  <DownloadIcon />
                  Windows (ARM)
                </a>
              </Button>
            </>
          ) : null}
        </div>
      </SectionCard>
    </div>
  )
}
